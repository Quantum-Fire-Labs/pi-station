import type { ServerResponse } from "node:http"
import { describe, expect, it, vi } from "vitest"
import { EventJournal } from "../event-journal.js"

const key = { projectId: "project", sessionId: "session" }
const timeline = (text: string) => ({
  version: 2 as const,
  type: "timeline" as const,
  timeline: [{ id: text, kind: "user" as const, text }],
})

describe("EventJournal authoritative view ordering", () => {
  it("does not replay events older than an authoritative Session view", () => {
    const journal = new EventJournal()
    journal.publish(key, timeline("stale"))
    const cursor = journal.cursor()
    const write = vi.fn()

    journal.subscribe(key, { write } as unknown as ServerResponse, cursor)

    expect(write).not.toHaveBeenCalled()
  })

  it("uses the Session ID across derived Project routing contexts", () => {
    const journal = new EventJournal()
    journal.publish({ projectId: "old-project", sessionId: "stable" }, timeline("moved"))
    const write = vi.fn()

    journal.subscribe({ projectId: "new-project", sessionId: "stable" }, { write } as unknown as ServerResponse, 0)

    expect(write.mock.calls[0]?.[0]).toContain("moved")
  })

  it("replays events published after the view cursor", () => {
    const journal = new EventJournal()
    const cursor = journal.cursor()
    journal.publish(key, timeline("new"))
    const write = vi.fn()

    journal.subscribe(key, { write } as unknown as ServerResponse, cursor)

    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.[0]).toContain("new")
  })
})
