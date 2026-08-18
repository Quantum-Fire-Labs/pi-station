import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  MAX_SHARED_FILE_BYTES,
  normalizeSharedFileOrigin,
  SharedFileError,
  SharedFileService,
  sharedFileInstructions,
  sharedSessionDirectoryName,
} from "../shared-files.js"

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ readonly root: string; readonly service: SharedFileService }> {
  const root = await mkdtemp(join(tmpdir(), "pi-station-sdk-shared-"))
  cleanup.push(root)
  const service = new SharedFileService(join(root, "shared"))
  await service.initialize()
  return { root, service }
}

async function serve(service: SharedFileService): Promise<{ readonly base: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname.slice("/shared/".length)
    void service.serve(path, request, response).catch((error: unknown) => {
      response.statusCode = error instanceof SharedFileError ? error.status : 500
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${address.port}/shared`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  }
}

describe("SDK shared files", () => {
  it("uses collision-resistant directories and gives every Session local and Tailscale links", () => {
    expect(sharedSessionDirectoryName("session/a")).not.toBe(sharedSessionDirectoryName("session?a"))
    const instructions = sharedFileInstructions("/home/user/.pi/agent/pi-station/shared", {
      publicOrigin: "https://station.example.ts.net:8797",
      localOrigin: "http://127.0.0.1:8801",
    }, "child/session")
    expect(instructions).toContain("/home/user/.pi/agent/pi-station/shared/session-")
    expect(instructions).toContain("/shared/session-")
    expect(instructions).toContain("https://station.example.ts.net:8797/shared/")
    expect(instructions).toContain("http://127.0.0.1:8801/shared/")
    expect(instructions).toContain("Do not share a file from another Session directory")
    const parentInstructions = sharedFileInstructions("/shared", { publicOrigin: "https://station.test", localOrigin: "http://127.0.0.1:8801" }, "parent")
    const childInstructions = sharedFileInstructions("/shared", { publicOrigin: "https://station.test", localOrigin: "http://127.0.0.1:8801" }, "child")
    expect(parentInstructions).toContain("/shared/parent/<filename>")
    expect(childInstructions).toContain("/shared/child/<filename>")
    expect(childInstructions).not.toContain("/shared/parent/")
    expect(normalizeSharedFileOrigin("https://station.test:8797")).toBe("https://station.test:8797")
    expect(() => normalizeSharedFileOrigin("https://station.test/path")).toThrow("exact HTTP or HTTPS origin")
  })

  it("lists only the selected Session and does not follow file or Session-directory symlinks", async () => {
    const { root, service } = await fixture()
    const parent = service.directoryForSession("parent")
    const child = service.directoryForSession("child")
    const outside = join(root, "outside")
    await Promise.all([mkdir(parent), mkdir(child), mkdir(outside)])
    await writeFile(join(parent, "parent.md"), "Parent")
    await writeFile(join(child, "child.md"), "Child")
    await writeFile(join(outside, "secret.txt"), "Secret")
    await symlink(join(outside, "secret.txt"), join(child, "link.txt"))

    expect((await service.list("parent")).map((file) => file.name)).toEqual(["parent.md"])
    expect((await service.list("child")).map((file) => file.name)).toEqual(["child.md"])

    await expect(service.serve("child/link.txt", { method: "GET", url: "/shared/child/link.txt", headers: {} } as never, {} as never))
      .rejects.toMatchObject({ status: 403 })
    await rm(child, { recursive: true })
    await symlink(outside, child)
    expect(await service.list("child")).toEqual([])
  })

  it("rejects traversal and encoded path separators", async () => {
    const { service } = await fixture()
    for (const path of ["../secret", "session/%2e%2e", "session/%2Fetc", "session/..%5Csecret", "session/sub/file.txt"]) {
      await expect(service.serve(path, { method: "GET", url: `/shared/${path}`, headers: {} } as never, {} as never))
        .rejects.toBeInstanceOf(SharedFileError)
    }
  })

  it("serves bounded files with safe types, sandboxing, and download behavior", async () => {
    const { service } = await fixture()
    const directory = service.directoryForSession("session")
    await mkdir(directory)
    await writeFile(join(directory, "page.html"), "<h1>Safe preview</h1><script>top.location='https://bad.example'</script>")
    await writeFile(join(directory, "archive.bin"), "binary")
    await writeFile(join(directory, "large.pdf"), "")
    await truncate(join(directory, "large.pdf"), MAX_SHARED_FILE_BYTES + 1)
    const server = await serve(service)
    try {
      const page = await fetch(`${server.base}/session/page.html`)
      expect(page.status).toBe(200)
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(page.headers.get("content-security-policy")).toContain("sandbox")
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'")
      expect(page.headers.get("x-content-type-options")).toBe("nosniff")
      expect(page.headers.get("content-disposition")).toMatch(/^inline/u)

      const archive = await fetch(`${server.base}/session/archive.bin`)
      expect(archive.headers.get("content-type")).toBe("application/octet-stream")
      expect(archive.headers.get("content-disposition")).toMatch(/^attachment/u)
      expect((await fetch(`${server.base}/session/large.pdf`)).status).toBe(413)
    } finally {
      await server.close()
    }
  })

  it("redirects Markdown to the mature editor and rejects stale or oversized manual saves", async () => {
    const { service } = await fixture()
    const directory = service.directoryForSession("session")
    await mkdir(directory)
    await writeFile(join(directory, "draft.md"), "First\n")
    const server = await serve(service)
    try {
      const editor = await fetch(`${server.base}/session/draft.md`, { redirect: "manual" })
      expect(editor.status).toBe(302)
      expect(editor.headers.get("location")).toContain("/shared-editor?file=")

      const first = await fetch(`${server.base}/session/draft.md?raw`)
      const firstRevision = first.headers.get("etag")
      expect(await first.text()).toBe("First\n")
      expect(firstRevision).toBeTruthy()

      const saved = await fetch(`${server.base}/session/draft.md`, {
        method: "PUT",
        headers: { "content-type": "text/markdown", "if-match": firstRevision! },
        body: "Second\n",
      })
      expect(saved.status).toBe(204)
      expect(saved.headers.get("etag")).not.toBe(firstRevision)

      const stale = await fetch(`${server.base}/session/draft.md`, {
        method: "PUT",
        headers: { "content-type": "text/markdown", "if-match": firstRevision! },
        body: "Stale\n",
      })
      expect(stale.status).toBe(412)
      const oversized = await fetch(`${server.base}/session/draft.md`, {
        method: "PUT",
        headers: { "content-type": "text/markdown" },
        body: "x".repeat(5 * 1024 * 1024 + 1),
      })
      expect(oversized.status).toBe(413)
    } finally {
      await server.close()
    }
  })
})
