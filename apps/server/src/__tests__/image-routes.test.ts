import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime, StartRuntimeTurn } from "../session-runtime.js"
import { createPiStationServer } from "../server.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "pi-station-images-"))
  roots.push(dataDir)
  const saved = { id: "session-1", projectId: "pending", path: "/sessions/session-1.jsonl", modifiedAt: "2026-01-01T00:00:00.000Z" }
  let projectId = ""
  const historyImageId = "history_image_1"
  const index: SessionIndex = {
    list: () => Promise.resolve([{ ...saved, projectId }]),
    get: (key) => Promise.resolve(key.sessionId === saved.id ? { ...saved, projectId: key.projectId } : undefined),
    indexSession: (session) => Promise.resolve(session),
    refreshSession: (key) => Promise.resolve({ ...saved, projectId: key.projectId }),
    timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
    timelineImage: (_session, imageId) => Promise.resolve(imageId === historyImageId
      ? { mediaType: "image/png", data: png }
      : undefined),
    rename: (session, name) => Promise.resolve({ ...session, name }),
  }
  let started: StartRuntimeTurn | undefined
  const runner = {
    run: vi.fn((input: StartRuntimeTurn) => {
      started = input
      return { completion: new Promise(() => undefined), ownershipLost: new Promise<never>(() => undefined), steer: () => Promise.resolve(), followUp: () => Promise.resolve(), abort: () => Promise.resolve(), control: vi.fn() }
    }),
    control: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SessionRuntime
  const server = createPiStationServer({ dataDir, index, runner })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("No address")
  const base = `http://127.0.0.1:${address.port}`
  const projects = await fetch(`${base}/v2/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root: dataDir }),
  })
  projectId = ((await projects.json()) as { projects: Array<{ id: string }> }).projects[0]!.id
  return { base, historyImageId, projectId, server, started: () => started }
}

async function upload(base: string, body: Uint8Array, contentType: string): Promise<Response> {
  return fetch(`${base}/v2/images`, { method: "POST", headers: { "content-type": contentType }, body: new Blob([Uint8Array.from(body)]) })
}

describe("Pi Station image attachments", () => {
  it("uploads raw image bytes and delivers base64 data to the SDK runtime turn", async () => {
    const test = await setup()
    try {
      const response = await upload(test.base, png, "image/png")
      expect(response.status).toBe(201)
      const uploaded = await response.json() as { version: number; id: string; mediaType: string; size: number }
      expect(uploaded.id).toMatch(/^[A-Za-z0-9_-]+$/u)
      expect(uploaded).toEqual({ version: 2, id: uploaded.id, mediaType: "image/png", size: png.length })

      const turn = await fetch(`${test.base}/v2/projects/${test.projectId}/sessions/session-1/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Inspect this", imageIds: [uploaded.id] }),
      })
      expect(turn.status).toBe(202)
      expect(test.started()).toMatchObject({
        prompt: "Inspect this",
        images: [{ mediaType: "image/png", data: png.toString("base64") }],
      })
    } finally {
      await new Promise<void>((resolve) => test.server.close(() => resolve()))
    }
  })

  it("serves only a validated image from the authoritative Session scope", async () => {
    const test = await setup()
    try {
      const response = await fetch(`${test.base}/v2/projects/${test.projectId}/sessions/session-1/images/${test.historyImageId}`)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/png")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin")
      expect(response.headers.get("content-security-policy")).toContain("sandbox")
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png)

      const unavailable = await fetch(`${test.base}/v2/projects/${test.projectId}/sessions/session-1/images/unknown`)
      expect(unavailable.status).toBe(404)
      expect(await unavailable.json()).toEqual({ error: "Image is not available" })
    } finally {
      await new Promise<void>((resolve) => test.server.close(() => resolve()))
    }
  })

  it("returns useful errors for unsupported, invalid, and oversized uploads", async () => {
    const test = await setup()
    try {
      const unsupported = await upload(test.base, png, "image/gif")
      expect(unsupported.status).toBe(415)
      expect(await unsupported.json()).toEqual({ error: "Use a PNG, JPEG, or WebP image" })

      const invalid = await upload(test.base, Buffer.from("not a png"), "image/png")
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: "Image data does not match its file type" })

      const oversized = await upload(test.base, Buffer.alloc(10 * 1024 * 1024 + 1), "image/png")
      expect(oversized.status).toBe(413)
      expect(await oversized.json()).toEqual({ error: "Image is larger than 10 MB" })
    } finally {
      await new Promise<void>((resolve) => test.server.close(() => resolve()))
    }
  })
})
