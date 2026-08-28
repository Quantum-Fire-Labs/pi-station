import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SavedSession } from "@pi-station/application-protocol"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime } from "../session-runtime.js"
import { createPiStationServer, shutdownPiStationServer } from "../server.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(): Promise<{ readonly base: string; readonly close: () => Promise<void> }> {
  const dataDir = await mkdtemp(join(tmpdir(), "pi-station-navigation-"))
  roots.push(dataDir)
  const saved: SavedSession = { id: "session", projectId: "project", path: join(dataDir, "session.jsonl"), modifiedAt: "2026-01-01T00:00:00.000Z", state: "open" }
  const index = {
    list: () => Promise.resolve([saved]), get: ({ projectId, sessionId }: { projectId: string; sessionId: string }) => Promise.resolve(projectId === "project" && sessionId === "session" ? saved : undefined),
    indexSession: vi.fn(), refreshSession: vi.fn(), timeline: () => Promise.resolve([]),
    historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }), rename: vi.fn(),
  } as unknown as SessionIndex
  const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
  const server = createPiStationServer({ dataDir, index, runner })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("No address")
  return { base: `http://127.0.0.1:${address.port}`, close: () => shutdownPiStationServer(server, 25) }
}

describe("navigation IPC", () => {
  it("broadcasts a validated Session target to connected web clients", async () => {
    const { base, close } = await fixture()
    const stream = await fetch(`${base}/v2/navigation/events`)
    const reader = stream.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain(": connected")

    const response = await fetch(`${base}/v2/navigation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "project", session: "session" }),
    })
    expect(response.status).toBe(202)
    const event = new TextDecoder().decode((await reader.read()).value)
    expect(event).toContain("event: navigation")
    expect(event).toContain('data: {"project":"project","session":"session"}')
    await reader.cancel()
    await close()
  })

  it("rejects malformed and unknown targets", async () => {
    const { base, close } = await fixture()
    const send = (body: unknown) => fetch(`${base}/v2/navigation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    expect((await send({ project: "project", session: "session", extra: true })).status).toBe(400)
    expect((await send({ project: "project", session: "missing" })).status).toBe(404)
    await close()
  })
})
