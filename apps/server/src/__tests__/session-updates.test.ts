import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { ServerResponse } from "node:http"
import { SessionUpdates } from "../session-updates.js"

const session = { id: "s1", projectId: "p1", path: "/s1.jsonl", modifiedAt: "2026-01-01T00:00:00.000Z", state: "open" as const }

describe("SessionUpdates", () => {
  it("publishes only the changed Session", () => {
    const updates = new SessionUpdates()
    const write = vi.fn()
    const response = { write } as unknown as ServerResponse
    updates.subscribe(response, 0)

    updates.publish(session)

    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.[0]).toContain('"type":"session.updated"')
    expect(write.mock.calls[0]?.[0]).toContain('"id":"s1"')
  })

  it("replays metadata and authoritative terminal phase updates after the snapshot sequence", () => {
    const updates = new SessionUpdates()
    updates.publish(session)
    updates.publishPhase({ projectId: "p1", sessionId: "s1", phase: "idle", epoch: "server-two", generation: 0 })
    const write = vi.fn()

    updates.subscribe({ write } as unknown as ServerResponse, 1)

    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.[0]).toContain("event: session.phase")
    expect(write.mock.calls[0]?.[0]).toContain('"phase":"idle"')
    expect(write.mock.calls[0]?.[0]).toContain('"epoch":"server-two"')
  })

  it("stops publishing after disconnect", () => {
    const updates = new SessionUpdates()
    const write = vi.fn()
    const response = Object.assign(new EventEmitter(), { write }) as unknown as ServerResponse
    const unsubscribe = updates.subscribe(response, 0)
    unsubscribe()

    updates.publish(session)

    expect(write).not.toHaveBeenCalled()
  })
})
