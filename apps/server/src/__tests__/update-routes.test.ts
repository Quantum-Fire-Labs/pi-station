import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import { createPiStationServer } from "../server.js"
import type { SessionRuntime } from "../session-runtime.js"
import type { PiStationUpdater } from "../updater.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const index: SessionIndex = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(undefined),
  indexSession: (session) => Promise.resolve(session),
  refreshSession: () => Promise.resolve(undefined),
  timeline: () => Promise.resolve([]),
  historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
  timelineImage: () => Promise.resolve(undefined),
  rename: (session) => Promise.resolve(session),
}
const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime

describe("update routes", () => {
  it("applies origin and JSON mutation protections and validates the channel strictly", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-update-routes-")); roots.push(dataDir)
    const status = { channel: "stable" as const, currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true }
    const readStatus = vi.fn().mockResolvedValue(status)
    const setChannel = vi.fn().mockResolvedValue({ ...status, channel: "edge" })
    const requestUpdate = vi.fn().mockResolvedValue(undefined)
    const updater = { status: readStatus, setChannel, requestUpdate } as unknown as PiStationUpdater
    const server = createPiStationServer({ dataDir, index, runner, updater })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address(); if (address === null || typeof address === "string") throw new Error("No server address")
    const base = `http://127.0.0.1:${address.port}`
    try {
      const read = await fetch(`${base}/v2/update`)
      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({ update: status })

      const badOrigin = await fetch(`${base}/v2/update`, { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}" })
      expect(badOrigin.status).toBe(403)
      const badContentType = await fetch(`${base}/v2/update/channel`, { method: "PUT", body: JSON.stringify({ channel: "edge" }) })
      expect(badContentType.status).toBe(415)
      const invalid = await fetch(`${base}/v2/update/channel`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "nightly" }) })
      expect(invalid.status).toBe(400)
      expect(setChannel).not.toHaveBeenCalled()

      const changed = await fetch(`${base}/v2/update/channel`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "edge" }) })
      expect(changed.status).toBe(200)
      expect(setChannel).toHaveBeenCalledWith("edge")
      const requested = await fetch(`${base}/v2/update`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      expect(requested.status).toBe(202)
      expect(requestUpdate).toHaveBeenCalledOnce()
      expect(JSON.stringify(await requested.json())).not.toContain("credential")

      requestUpdate.mockRejectedValueOnce(new Error("private launcher details"))
      const failed = await fetch(`${base}/v2/update`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      expect(failed.status).toBe(503)
      expect(await failed.json()).toEqual({ error: "The update job could not start. Check the Pi Station service logs and try again." })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
