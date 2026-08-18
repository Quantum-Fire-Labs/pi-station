import { describe, expect, it } from "vitest"
import type { SessionHistoryPage } from "./sessions.js"

describe("Session history page contract", () => {
  it("keeps the cursor opaque and omits it when no earlier history exists", () => {
    const page: SessionHistoryPage = {
      version: 2,
      revision: "revision-a",
      hasEarlier: false,
      timeline: [],
    }
    expect(page.before).toBeUndefined()
    expect(page.hasEarlier).toBe(false)
  })

  it("carries stable tool identity and lifecycle state", () => {
    const page: SessionHistoryPage = {
      version: 2,
      revision: "revision-a",
      hasEarlier: false,
      timeline: [{ id: "tool-call-call-1", kind: "tool", toolCallId: "call-1", title: "read", inputText: "README.md", text: "Done", state: "succeeded" }],
    }
    expect(page.timeline[0]).toMatchObject({ id: "tool-call-call-1", toolCallId: "call-1", state: "succeeded" })
  })

  it("carries only normalized Timeline items", () => {
    const page: SessionHistoryPage = {
      version: 2,
      revision: "revision-a",
      before: "opaque-boundary",
      hasEarlier: true,
      timeline: [{ id: "message-1", kind: "user", text: "Hello", images: [{ id: "image-1", mediaType: "image/png", status: "available" }] }],
    }
    expect(page.timeline[0]?.id).toBe("message-1")
  })
})
