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

describe("Pi Station shutdown", () => {
  it("closes global and Session SSE streams before bounded SDK disposal", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-shutdown-"))
    roots.push(dataDir)
    const saved: SavedSession = { id: "session", projectId: "project", path: join(dataDir, "session.jsonl"), modifiedAt: "2026-01-01T00:00:00.000Z", state: "open" }
    const index = {
      list: () => Promise.resolve([saved]), get: () => Promise.resolve(saved), indexSession: vi.fn(), refreshSession: vi.fn(), timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }), rename: vi.fn(),
    } as unknown as SessionIndex
    const interruptOwned = vi.fn()
    const dispose = vi.fn()
    const runner = { run: vi.fn(), control: vi.fn(), interruptOwned, dispose } as unknown as SessionRuntime
    const server = createPiStationServer({ dataDir, index, runner, phaseEpoch: "test-server-epoch" })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("No address")
    const base = `http://127.0.0.1:${address.port}`

    const [globalStream, sessionStream] = await Promise.all([
      fetch(`${base}/v2/sessions/events`),
      fetch(`${base}/v2/projects/project/sessions/session/events`),
    ])
    expect(globalStream.status).toBe(200)
    expect(sessionStream.status).toBe(200)

    const started = performance.now()
    await shutdownPiStationServer(server, 25)
    expect(performance.now() - started).toBeLessThan(500)
    await expect(globalStream.text()).resolves.toContain(": connected")
    await expect(sessionStream.text()).resolves.toContain("data: {\"version\":2,\"type\":\"phase\",\"phase\":\"idle\",\"epoch\":\"test-server-epoch\",\"generation\":0}")
    expect(interruptOwned).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
