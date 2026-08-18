import { createHash, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import type { IncomingMessage } from "node:http"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import type { SessionKey } from "@pi-station/application-protocol"
import { HttpError } from "./http.js"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_MESSAGE_ATTACHMENTS = 4
export const ATTACHMENT_CUSTOM_TYPE = "pi-station-attachments"
const ATTACHMENT_PROMPT_DELIMITER = "\n\n<pi-station-generated-attachment-paths:v1>\n"

export interface SessionAttachment { readonly id: string; readonly name: string; readonly mediaType: string; readonly size: number }
export interface ResolvedAttachment extends SessionAttachment { readonly path: string }

export class SessionAttachmentStore {
  readonly #root: string
  constructor(dataDir: string) { this.#root = resolve(dataDir, "session-attachments") }

  async upload(key: SessionKey, request: IncomingMessage, nameValue: string | undefined): Promise<SessionAttachment> {
    const name = safeName(nameValue)
    const mediaType = safeMediaType(request.headers["content-type"])
    const declared = Number(request.headers["content-length"] ?? 0)
    if (!Number.isSafeInteger(declared) || declared < 0) throw new HttpError(400, "File size is invalid")
    if (declared > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "File is larger than 25 MB")
    const directory = this.#directory(key)
    await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700)
    const id = randomBytes(24).toString("base64url")
    const temporary = join(directory, `.${id}.upload`); const destination = join(directory, id)
    let size = 0
    try {
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          callback(size > MAX_ATTACHMENT_BYTES ? new HttpError(413, "File is larger than 25 MB") : null, chunk)
        },
      })
      await pipeline(request, limiter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }))
      if (size === 0) throw new HttpError(400, "File is empty")
      await rename(temporary, destination); await chmod(destination, 0o600)
      const attachment = { id, name, mediaType, size }
      await writeFile(join(directory, `${id}.json`), JSON.stringify(attachment), { mode: 0o600, flag: "wx" })
      return attachment
    } catch (error) { await rm(temporary, { force: true }); await rm(destination, { force: true }); throw error }
  }

  async resolve(key: SessionKey, ids: readonly string[]): Promise<readonly ResolvedAttachment[] | undefined> {
    const values = await Promise.all(ids.map((id) => this.get(key, id)))
    return values.every((value) => value !== undefined) ? values : undefined
  }
  async get(key: SessionKey, id: string): Promise<ResolvedAttachment | undefined> {
    if (!validId(id)) return undefined
    try {
      const directory = this.#directory(key)
      const metadataPath = contained(directory, `${id}.json`)
      const path = contained(directory, id)
      const [metadataDetails, details] = await Promise.all([lstat(metadataPath), lstat(path)])
      if (!metadataDetails.isFile() || metadataDetails.isSymbolicLink() || !details.isFile() || details.isSymbolicLink()) return undefined
      const parsed: unknown = JSON.parse(await readFile(metadataPath, "utf8"))
      if (!isAttachmentMetadata(parsed, id) || details.size !== parsed.size) return undefined
      return { ...parsed, path }
    } catch { return undefined }
  }
  async delete(key: SessionKey, id: string): Promise<boolean> {
    if (!validId(id) || await this.get(key, id) === undefined) return false
    await Promise.all([rm(join(this.#directory(key), id), { force: true }), rm(join(this.#directory(key), `${id}.json`), { force: true })]); return true
  }
  stream(value: ResolvedAttachment) { return createReadStream(value.path) }
  #directory(key: SessionKey): string {
    return contained(this.#root, safeComponent(key.projectId), safeComponent(key.sessionId))
  }
}

export function attachmentPrompt(prompt: string, attachments: readonly ResolvedAttachment[]): string {
  if (attachments.length === 0) return prompt
  const paths = attachments.map((file) => `- ${file.name}: ${file.path}`).join("\n")
  return `${prompt}${ATTACHMENT_PROMPT_DELIMITER}Attached files (local paths; do not execute or extract automatically):\n${paths}`
}
export function stripAttachmentPromptSuffix(prompt: string): string {
  const delimiter = prompt.lastIndexOf(ATTACHMENT_PROMPT_DELIMITER)
  return delimiter < 0 ? prompt : prompt.slice(0, delimiter)
}
export function attachmentMarker(attachments: readonly ResolvedAttachment[]) {
  return { kind: "attachments", attachments: attachments.map(({ id, name, mediaType, size }) => ({ id, name, mediaType, size })) }
}
function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,64}$/u.test(value) }
function safeComponent(value: string): string { return createHash("sha256").update(value).digest("base64url") }
function contained(root: string, ...parts: string[]): string {
  const path = resolve(root, ...parts)
  const fromRoot = relative(root, path)
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(fromRoot))) return path
  throw new Error("Attachment path escapes its storage root")
}
function isAttachmentMetadata(value: unknown, id: string): value is SessionAttachment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const file = value as Record<string, unknown>
  return file.id === id && typeof file.name === "string" && file.name.length > 0 && file.name.length <= 200
    && typeof file.mediaType === "string" && file.mediaType.length > 0 && file.mediaType.length <= 100
    && typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES
}
function safeName(value: string | undefined): string {
  const sanitized = [...(value ?? "file")].map((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f ? "_" : character
  }).join("")
  const name = basename(sanitized).slice(0, 200)
  return name || "file"
}
function safeMediaType(value: string | undefined): string { const type = value?.split(";", 1)[0]?.trim().toLowerCase(); return type !== undefined && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(type) && type.length <= 100 ? type : "application/octet-stream" }
