import { PassThrough } from "node:stream"
import type { IncomingMessage } from "node:http"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SessionAttachmentStore, attachmentPrompt, stripAttachmentPromptSuffix } from "../session-attachments.js"

const key = { projectId: "project-a", sessionId: "session-a" }
function request(data: Buffer, headers: Record<string, string> = {}) {
  const stream = new PassThrough() as PassThrough & { headers: Record<string, string> }
  stream.headers = { "content-length": String(data.length), "content-type": "application/octet-stream", ...headers }
  stream.end(data)
  return stream as unknown as IncomingMessage
}

describe("SessionAttachmentStore", () => {
  it("persists opaque Session-owned files with private permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-attachments-")); const store = new SessionAttachmentStore(root)
    const saved = await store.upload(key, request(Buffer.from("hello")), "../notes.txt")
    expect(saved.name).toBe("notes.txt")
    const resolved = await store.get(key, saved.id)
    expect(resolved).toBeDefined(); expect(await readFile(resolved!.path, "utf8")).toBe("hello")
    expect((await stat(resolved!.path)).mode & 0o777).toBe(0o600)
    const buffered = await store.save(key, Buffer.from("image"), "screen.png", "image/png")
    expect(buffered.name).toBe("screen.png")
    expect(buffered.mediaType).toBe("image/png")
    expect(await readFile(buffered.path, "utf8")).toBe("image")
    expect(await store.get({ ...key, sessionId: "other" }, saved.id)).toBeUndefined()
    const injected = attachmentPrompt("Review", [resolved!])
    expect(injected).toContain(resolved!.path)
    expect(stripAttachmentPromptSuffix(injected)).toBe("Review")
  })

  it("uses contained deterministic directories for hostile Project and Session IDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-attachments-")); const store = new SessionAttachmentStore(root)
    const saved = await store.upload({ projectId: "../../outside", sessionId: "/tmp/session" }, request(Buffer.from("safe")), "safe.txt")
    const resolved = await store.get({ projectId: "../../outside", sessionId: "/tmp/session" }, saved.id)
    expect(resolved?.path.startsWith(join(root, "session-attachments"))).toBe(true)
  })

  it("keeps delimiter-like user text unless it is the generated suffix", () => {
    const text = "Keep <pi-station-generated-attachment-paths:v1> in this text"
    expect(stripAttachmentPromptSuffix(text)).toBe(text)
  })

  it("deletes only an attachment owned by the Session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-attachments-")); const store = new SessionAttachmentStore(root)
    const saved = await store.upload(key, request(Buffer.from("hello")), "notes.txt")
    expect(await store.delete({ ...key, sessionId: "other" }, saved.id)).toBe(false)
    expect(await store.delete(key, saved.id)).toBe(true)
    expect(await store.get(key, saved.id)).toBeUndefined()
  })
})
