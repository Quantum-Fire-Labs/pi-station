/* eslint-disable @typescript-eslint/require-await */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  NotificationPresenceStore,
  NotificationRepository,
  NotificationService,
  notificationPayload,
  normalizeMarkdown,
  truncate,
} from "../notification-service.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const deviceA = "01900000-0000-7000-8000-000000000001"
const deviceB = "01900000-0000-7000-8000-000000000002"
const key = (bytes: number, first?: number) => Buffer.from([...(first === undefined ? [] : [first]), ...Array<number>(bytes - (first === undefined ? 0 : 1)).fill(1)]).toString("base64url")
const subscription = (endpoint: string, deviceClass: "desktop" | "mobile") => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: key(65, 4), auth: key(16) },
  deviceClass,
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "pi-station-notifications-"))
  roots.push(root)
  let now = 1_000
  const repository = new NotificationRepository(root, () => now)
  const presence = new NotificationPresenceStore(() => now)
  const sender = vi.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: "" })
  const service = new NotificationService(root, repository, presence, sender)
  return { repository, presence, sender, service, advance: (milliseconds: number) => { now += milliseconds } }
}

const attention = {
  id: "attention-1",
  projectId: "project-one",
  sessionId: "session-one",
  sessionName: "Release Session",
  kind: "completed" as const,
  text: "**Finished** safely",
}

describe("SDK notification service", () => {
  it("builds bounded notification text without prompt, thinking, or tool content", () => {
    expect(normalizeMarkdown("# Done\n**Safe** [link](https://example.test/private)")).toBe("Done Safe link")
    const payload = notificationPayload({ ...attention, text: "😀".repeat(300) })
    expect(payload.title).toBe("Release Session")
    expect(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(payload.body))).toHaveLength(240)
    expect(Buffer.byteLength(payload.body)).toBeLessThanOrEqual(960)
    expect(payload.data).toEqual({ hostId: "project-one", piSessionId: "session-one" })
    expect(truncate("abcdef", 4, 20)).toBe("abc…")
    expect(notificationPayload({ ...attention, kind: "needs-attention", text: "private failure" }).body).toBe("This Session needs your attention.")
  })

  it("delivers one attention event once and removes a gone provider", async () => {
    const h = await harness()
    await h.repository.upsert(deviceA, subscription("https://push.example.test/ok", "desktop"))
    await h.repository.upsert(deviceB, subscription("https://push.example.test/gone", "desktop"))
    h.sender.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
      if (endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 })
      return { statusCode: 201, headers: {}, body: "" }
    })

    await h.service.notify(attention)
    await h.service.notify(attention)
    expect(h.sender).toHaveBeenCalledTimes(2)
    expect(JSON.parse(h.sender.mock.calls[0]![1] as string)).toMatchObject({
      title: "Release Session",
      body: "Finished safely",
      data: { hostId: "project-one", piSessionId: "session-one" },
    })
    expect((await h.repository.list()).map((item) => item.endpoint)).toEqual(["https://push.example.test/ok"])
  })

  it("suppresses only the visible selected Session and paused mobile delivery", async () => {
    const h = await harness()
    await h.repository.upsert(deviceA, subscription("https://push.example.test/desktop", "desktop"))
    await h.repository.upsert(deviceB, subscription("https://push.example.test/mobile", "mobile"))
    h.presence.report({
      deviceId: deviceA,
      desktopActive: true,
      visibleSession: { projectId: attention.projectId, sessionId: attention.sessionId },
    })

    await h.service.notify(attention)
    expect(h.sender).not.toHaveBeenCalled()

    h.advance(45_001)
    await h.service.notify({ ...attention, id: "attention-2" })
    expect(h.sender).toHaveBeenCalledTimes(2)
  })
})
