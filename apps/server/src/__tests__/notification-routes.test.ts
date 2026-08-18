import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime } from "../session-runtime.js"
import { createPiStationServer } from "../server.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const key = (bytes: number, first?: number) => Buffer.from([...(first === undefined ? [] : [first]), ...Array<number>(bytes - (first === undefined ? 0 : 1)).fill(1)]).toString("base64url")

describe("Pi Station notification routes", () => {
  it("keeps permission actions explicit and validates subscription and presence input", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-notification-routes-"))
    roots.push(dataDir)
    const index = {
      list: () => Promise.resolve([]), get: () => Promise.resolve(undefined), indexSession: vi.fn(), refreshSession: vi.fn(), timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }), rename: vi.fn(),
    } as unknown as SessionIndex
    const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
    const server = createPiStationServer({ dataDir, index, runner, notificationSender: vi.fn() })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("No address")
    const base = `http://127.0.0.1:${address.port}`
    const deviceId = "01900000-0000-7000-8000-000000000001"
    const endpoint = "https://push.example.test/device"
    try {
      const capabilities = await fetch(`${base}/v2/notifications/capabilities`)
      expect(capabilities.status).toBe(200)
      const capabilityBody = await capabilities.json() as { available: boolean; publicKey: string }
      expect(capabilityBody.available).toBe(true)
      expect(capabilityBody.publicKey).toMatch(/^[A-Za-z0-9_-]+$/u)

      const subscribed = await fetch(`${base}/v2/notifications/subscription`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          action: "subscribe", deviceId,
          subscription: { endpoint, expirationTime: null, keys: { p256dh: key(65, 4), auth: key(16) }, deviceClass: "desktop" },
        }),
      })
      expect(subscribed.status).toBe(201)

      const presence = await fetch(`${base}/v2/notifications/presence`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          deviceId, desktopActive: true, visibleSession: { projectId: "project", sessionId: "session" },
        }),
      })
      expect(presence.status).toBe(200)

      const malformed = await fetch(`${base}/v2/notifications/presence`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, desktopActive: true, prompt: "private" }),
      })
      expect(malformed.status).toBe(400)

      const unsubscribed = await fetch(`${base}/v2/notifications/subscription`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", deviceId, endpoint }),
      })
      expect(unsubscribed.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
