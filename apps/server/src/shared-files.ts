import { createHash } from "node:crypto"
import { constants, watch } from "node:fs"
import { lstat, mkdir, open, opendir, realpath, type FileHandle } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname, extname, resolve, sep } from "node:path"
import type { SharedFileInfo } from "@pi-station/application-protocol"

export const MAX_SHARED_FILE_BYTES = 25 * 1024 * 1024
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024
const MAX_LISTED_FILES = 100
const MAX_INSPECTED_ENTRIES = 500

const INLINE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
}

const DOWNLOAD_MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
}

export interface SharedFileOrigins {
  readonly publicOrigin: string
  readonly localOrigin: string
}

export class SharedFileError extends Error {
  constructor(readonly status: number, message = "Shared file request failed") {
    super(message)
  }
}

export function sharedSessionDirectoryName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/gu, "-")
  if (safe !== "" && safe.length <= 200 && safe !== "." && safe !== ".." && safe === sessionId) return safe
  return `session-${createHash("sha256").update(sessionId).digest("base64url").slice(0, 32)}`
}

export function normalizeSharedFileOrigin(value: string): string {
  let origin: URL
  try {
    origin = new URL(value)
  } catch {
    throw new Error("Shared file origin is invalid")
  }
  if ((origin.protocol !== "http:" && origin.protocol !== "https:")
    || origin.username !== "" || origin.password !== ""
    || origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    throw new Error("Shared file origin must be an exact HTTP or HTTPS origin")
  }
  return origin.origin
}

export function sharedFileInstructions(directory: string, origins: SharedFileOrigins, sessionId: string, projectId?: string): string {
  const sessionDirectory = sharedSessionDirectoryName(sessionId)
  const relativeUrl = `/shared/${encodeURIComponent(sessionDirectory)}/<filename>`
  const publicUrl = `${withoutTrailingSlash(origins.publicOrigin)}${relativeUrl}`
  const localUrl = `${withoutTrailingSlash(origins.localOrigin)}${relativeUrl}`
  const localLine = localUrl === publicUrl ? "" : `\nLocal Workspace URL:\n\n${localUrl}\n`
  return `## Sharing files with the user

To share a file, create this Session-specific directory when needed and write or copy the file beneath it:

${resolve(directory, sessionDirectory)}/

Use a simple URL-safe filename. Give the user a Markdown link with this Workspace-relative URL so it works from the local and Tailscale Workspace:

${relativeUrl}

Public Workspace URL:

${publicUrl}
${localLine}
Replace <filename> with the encoded filename. Do not share a file from another Session directory. Markdown files open in an editable Workspace pane and require a manual save. HTML, PDF, images, text, and JSON open safely. Other file types download. Files remain available until manually removed.${projectId === undefined ? "" : `

## Editing Project Markdown files with the user

To let the user edit an existing Markdown file in this Session's Project directly, link to:

/project-files/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}?path=<project-relative-path>

Percent-encode <project-relative-path>. The file must already exist beneath the Project working directory and end in .md or .markdown. Use this for collaborative Project files; use the shared directory above for copies and generated artifacts.`}`
}

export async function serveProjectMarkdown(root: string, relativePath: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (relativePath === "" || relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.includes("\0")) throw new SharedFileError(403)
  const extension = extname(relativePath).toLowerCase()
  if (extension !== ".md" && extension !== ".markdown") throw new SharedFileError(415)
  const projectRoot = await realpath(root).catch(() => { throw new SharedFileError(404) })
  const candidate = resolve(projectRoot, relativePath)
  if (!within(projectRoot, candidate) || candidate === projectRoot) throw new SharedFileError(403)
  const parameters = new URL(request.url ?? "/", "http://localhost").searchParams

  if (request.method === "GET" && parameters.has("watch")) {
    await assertSafeFile(projectRoot, candidate)
    serveWatch(candidate, request, response)
    return
  }
  if (request.method === "PUT") {
    await saveMarkdown(projectRoot, candidate, request, response)
    return
  }
  if (request.method !== "GET" && request.method !== "HEAD") throw new SharedFileError(405)
  const { content } = await readSafeFile(projectRoot, candidate, MAX_MARKDOWN_BYTES)
  response.writeHead(200, {
    ...fileHeaders("text/markdown; charset=utf-8", content.byteLength, "inline", relativePath),
    etag: revision(content),
  })
  response.end(request.method === "HEAD" ? undefined : content)
}

export class SharedFileService {
  readonly directory: string
  #root: string | undefined

  constructor(directory: string) {
    this.directory = resolve(directory)
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const entry = await lstat(this.directory)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Shared file root must be a regular directory")
    this.#root = await realpath(this.directory)
  }

  directoryForSession(sessionId: string): string {
    return resolve(this.directory, sharedSessionDirectoryName(sessionId))
  }

  instructions(origins: SharedFileOrigins, sessionId: string): string {
    return sharedFileInstructions(this.directory, origins, sessionId)
  }

  async list(sessionId: string): Promise<readonly SharedFileInfo[]> {
    const root = this.#requiredRoot()
    const sessionDirectory = resolve(root, sharedSessionDirectoryName(sessionId))
    try {
      await assertSafeDirectory(root, sessionDirectory)
      const directory = await opendir(sessionDirectory)
      const files: SharedFileInfo[] = []
      let inspected = 0
      try {
        for await (const entry of directory) {
          inspected += 1
          if (inspected > MAX_INSPECTED_ENTRIES || files.length >= MAX_LISTED_FILES) break
          if (!entry.isFile() || entry.isSymbolicLink() || !isSafeLeaf(entry.name)) continue
          const candidate = resolve(sessionDirectory, entry.name)
          try {
            const metadata = await lstat(candidate)
            if (!metadata.isFile() || metadata.isSymbolicLink()) continue
            const actual = await realpath(candidate)
            if (!within(sessionDirectory, actual)) continue
            files.push({
              name: entry.name,
              url: `/shared/${encodeURIComponent(sharedSessionDirectoryName(sessionId))}/${encodeURIComponent(entry.name)}`,
              size: metadata.size,
              modifiedAt: Math.trunc(metadata.mtimeMs),
            })
          } catch {
            // A file can change while the directory is listed.
          }
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
      return files.sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name))
    } catch {
      return []
    }
  }

  async serve(requestedPath: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { sessionDirectoryName, filename } = parseRequestedPath(requestedPath)
    const root = this.#requiredRoot()
    const sessionDirectory = resolve(root, sessionDirectoryName)
    await assertSafeDirectory(root, sessionDirectory)
    const candidate = resolve(sessionDirectory, filename)
    if (!within(sessionDirectory, candidate)) throw new SharedFileError(403)

    const parameters = new URL(request.url ?? "/", "http://localhost").searchParams
    const extension = extname(filename).toLowerCase()
    const markdown = extension === ".md" || extension === ".markdown"

    if (markdown && request.method === "GET" && parameters.has("watch")) {
      await assertSafeFile(sessionDirectory, candidate)
      serveWatch(candidate, request, response)
      return
    }

    if (markdown && request.method === "PUT") {
      await saveMarkdown(sessionDirectory, candidate, request, response)
      return
    }

    if (request.method !== "GET" && request.method !== "HEAD") throw new SharedFileError(405)

    if (markdown && !parameters.has("raw")) {
      await assertSafeFile(sessionDirectory, candidate)
      const editorUrl = `/shared-editor?file=${encodeURIComponent(`/shared/${encodeURIComponent(sessionDirectoryName)}/${encodeURIComponent(filename)}`)}`
      response.writeHead(302, { ...securityHeaders(), location: editorUrl, "cache-control": "no-store" })
      response.end()
      return
    }

    const maximum = markdown ? MAX_MARKDOWN_BYTES : MAX_SHARED_FILE_BYTES
    const { content } = await readSafeFile(sessionDirectory, candidate, maximum)
    const contentType = markdown
      ? "text/markdown; charset=utf-8"
      : INLINE_MIME_TYPES[extension] ?? DOWNLOAD_MIME_TYPES[extension] ?? "application/octet-stream"
    const disposition = markdown || extension in INLINE_MIME_TYPES ? "inline" : "attachment"
    response.writeHead(200, {
      ...fileHeaders(contentType, content.byteLength, disposition, filename),
      ...(markdown ? { etag: revision(content) } : {}),
    })
    response.end(request.method === "HEAD" ? undefined : content)
  }

  #requiredRoot(): string {
    if (this.#root === undefined) throw new Error("Shared file service is not initialized")
    return this.#root
  }
}

async function saveMarkdown(root: string, candidate: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "text/markdown") throw new SharedFileError(415)
  const declaredLength = Number.parseInt(request.headers["content-length"] ?? "0", 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MARKDOWN_BYTES) throw new SharedFileError(413)
  const next = await readBody(request, MAX_MARKDOWN_BYTES)
  const handle = await openSafeFile(root, candidate, constants.O_RDWR)
  try {
    const metadata = await handle.stat()
    if (metadata.size > MAX_MARKDOWN_BYTES) throw new SharedFileError(413)
    const current = await readHandle(handle, metadata.size)
    const expected = request.headers["if-match"]
    if (typeof expected === "string" && expected !== revision(current)) throw new SharedFileError(412)
    await handle.truncate(0)
    await handle.writeFile(next)
    await handle.sync()
    const visible = await lstat(candidate).catch(() => undefined)
    if (visible === undefined || visible.isSymbolicLink()
      || visible.dev !== metadata.dev || visible.ino !== metadata.ino) throw new SharedFileError(412)
    const persisted = await handle.stat()
    if (persisted.size > MAX_MARKDOWN_BYTES
      || revision(await readHandle(handle, persisted.size)) !== revision(next)) throw new SharedFileError(412)
  } finally {
    await handle.close()
  }
  response.writeHead(204, { ...securityHeaders(), "cache-control": "no-store", etag: revision(next) })
  response.end()
}

function parseRequestedPath(requestedPath: string): { readonly sessionDirectoryName: string; readonly filename: string } {
  const parts = requestedPath.split("/")
  if (parts.length !== 2 || parts.some((part) => part === "")) throw new SharedFileError(404)
  let sessionDirectoryName: string
  let filename: string
  try {
    sessionDirectoryName = decodeURIComponent(parts[0]!)
    filename = decodeURIComponent(parts[1]!)
  } catch {
    throw new SharedFileError(400)
  }
  if (!isSafeSessionDirectory(sessionDirectoryName) || !isSafeLeaf(filename)) throw new SharedFileError(403)
  return { sessionDirectoryName, filename }
}

function isSafeSessionDirectory(value: string): boolean {
  return value.length <= 200 && value !== "." && value !== ".." && /^[a-zA-Z0-9._-]+$/u.test(value)
}

function isSafeLeaf(value: string): boolean {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 31 || code === 127
  })
  return value.length > 0 && value.length <= 255 && value !== "." && value !== ".."
    && !value.includes("/") && !value.includes("\\") && !hasControlCharacter
}

async function assertSafeDirectory(root: string, path: string): Promise<void> {
  if (!within(root, path)) throw new SharedFileError(403)
  try {
    const metadata = await lstat(path)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new SharedFileError(403)
    const actual = await realpath(path)
    if (!within(root, actual)) throw new SharedFileError(403)
  } catch (error) {
    if (error instanceof SharedFileError) throw error
    throw new SharedFileError(404)
  }
}

async function assertSafeFile(sessionDirectory: string, candidate: string): Promise<void> {
  const handle = await openSafeFile(sessionDirectory, candidate, constants.O_RDONLY)
  await handle.close()
}

async function openSafeFile(sessionDirectory: string, candidate: string, flags: number): Promise<FileHandle> {
  try {
    const metadata = await lstat(candidate)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new SharedFileError(403)
    const actual = await realpath(candidate)
    if (!within(sessionDirectory, actual)) throw new SharedFileError(403)
    const handle = await open(candidate, flags | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      await handle.close()
      throw new SharedFileError(403)
    }
    return handle
  } catch (error) {
    if (error instanceof SharedFileError) throw error
    throw new SharedFileError(404)
  }
}

async function readSafeFile(sessionDirectory: string, candidate: string, maximum: number): Promise<{ readonly content: Buffer }> {
  const handle = await openSafeFile(sessionDirectory, candidate, constants.O_RDONLY)
  try {
    const metadata = await handle.stat()
    if (metadata.size > maximum) throw new SharedFileError(413)
    return { content: await readHandle(handle, metadata.size) }
  } finally {
    await handle.close()
  }
}

async function readHandle(handle: FileHandle, size: number): Promise<Buffer> {
  const content = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const result = await handle.read(content, offset, size - offset, offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return offset === size ? content : content.subarray(0, offset)
}

function serveWatch(path: string, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    ...securityHeaders(),
    "cache-control": "no-cache, no-store",
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
  })
  response.write("event: ready\ndata: {}\n\n")
  let changeTimer: NodeJS.Timeout | undefined
  const watcher = watch(dirname(path), (_event, changed) => {
    if (response.writableEnded || changed?.toString() !== basename(path)) return
    if (changeTimer !== undefined) clearTimeout(changeTimer)
    changeTimer = setTimeout(() => {
      changeTimer = undefined
      if (!response.writableEnded) response.write("event: change\ndata: {\"changed\":true}\n\n")
    }, 75)
  })
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": keepalive\n\n")
  }, 20_000)
  let closed = false
  const close = (endResponse: boolean): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    if (changeTimer !== undefined) clearTimeout(changeTimer)
    watcher.close()
    if (endResponse && !response.writableEnded) response.end()
  }
  watcher.once("error", () => close(true))
  request.once("close", () => close(true))
  response.once("close", () => close(false))
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array)
    size += value.length
    if (size > limit) throw new SharedFileError(413)
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function revision(content: Uint8Array): string {
  return `"${createHash("sha256").update(content).digest("base64url")}"`
}

function fileHeaders(type: string, length: number, disposition: "inline" | "attachment", filename: string): Record<string, string | number> {
  return {
    ...securityHeaders(),
    "cache-control": "no-store",
    "content-type": type,
    "content-length": length,
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(basename(filename))}`,
  }
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src data:; style-src 'unsafe-inline'",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  }
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "")
}
