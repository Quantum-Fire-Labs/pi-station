import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent"
import { projectActiveHistory, projectActiveTimeline, projectId, PublicSessionIndex, StaleHistoryCursorError } from "../domain.js"
import { projectActiveTimelineImage } from "../session-images.js"
import { attachmentMarker, attachmentPrompt } from "../session-attachments.js"

describe("public Session discovery", () => {
  it("assigns Sessions to the deepest configured Project and gives other Sessions a stable implicit Project", async () => {
    vi.spyOn(SessionManager, "listAll").mockResolvedValue([
      { id: "nested", cwd: "/work/root/nested/src", path: "/sessions/nested.jsonl", modified: new Date("2026-02-02"), created: new Date(), messageCount: 1, firstMessage: "", allMessagesText: "" },
      { id: "other", cwd: "/outside", path: "/sessions/other.jsonl", modified: new Date("2026-02-03"), created: new Date(), messageCount: 1, firstMessage: "", allMessagesText: "" },
    ])
    const directory = await mkdtemp(join(tmpdir(), "pi-station-discovery-"))
    const projects = [{ id: "root", root: "/work/root" }, { id: "nested-root", root: "/work/root/nested" }]
    const index = new PublicSessionIndex(directory)
    await index.list(projects)
    await index.refresh(projects)
    const sessions = await index.list(projects)
    expect(sessions).toEqual([
      expect.objectContaining({ id: "other", projectId: projectId("/outside"), cwd: "/outside" }),
      expect.objectContaining({ id: "nested", projectId: "nested-root", cwd: "/work/root/nested/src" }),
    ])
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })
})

describe("saved active-path projector", () => {
  it("projects only the entries supplied by the public active branch API", () => {
    const entries = [
      { type: "message", id: "u", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "Question" }], timestamp: 1 } },
      { type: "message", id: "a", parentId: "u", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Check" }, { type: "text", text: "Answer" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: 2 } },
    ] as unknown as SessionEntry[]
    expect(projectActiveTimeline(entries).map(({ kind }) => kind)).toEqual(["user", "thinking", "assistant"])
  })

  it("preserves compaction and branch summaries as distinct context entries", () => {
    const entries = [
      { type: "compaction", id: "compact", parentId: null, timestamp: "2026-01-01T00:00:00Z", summary: "## Goal\nKeep context" },
      { type: "branch_summary", id: "branch", parentId: "compact", timestamp: "2026-01-01T00:00:01Z", summary: "Alternate path" },
    ] as unknown as SessionEntry[]

    expect(projectActiveTimeline(entries)).toEqual([
      expect.objectContaining({ id: "compact", kind: "context-summary", summaryType: "compaction", text: "## Goal\nKeep context" }),
      expect.objectContaining({ id: "branch", kind: "context-summary", summaryType: "branch", text: "Alternate path" }),
    ])
  })

  it("removes generated attachment paths from user Timeline text but keeps them in the agent prompt", () => {
    const files = [{ id: "file-id", name: "notes.txt", mediaType: "text/plain", size: 5, path: "/private/session/notes" }]
    const prompt = attachmentPrompt("Review this", files)
    const entries = [
      { type: "custom_message", id: "marker", parentId: null, timestamp: "2026-01-01T00:00:00Z", customType: "pi-station-attachments", content: "Attached files", display: false, details: attachmentMarker(files) },
      { type: "message", id: "user", parentId: "marker", timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: prompt }], timestamp: 1 } },
    ] as unknown as SessionEntry[]
    expect(prompt).toContain("/private/session/notes")
    expect(projectActiveTimeline(entries)[0]).toMatchObject({ kind: "user", text: "Review this", attachments: [{ id: "file-id" }] })
  })

  it("keeps text and bounded image references from Pi-owned user history", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const entries = [{
      type: "message", id: "image-entry", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: [
        { type: "text", text: "Inspect this" },
        { type: "image", mimeType: "image/png", data: png.toString("base64") },
        { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz48L3N2Zz4=" },
      ], timestamp: 1 },
    }] as unknown as SessionEntry[]

    const user = projectActiveTimeline(entries)[0]
    expect(user).toMatchObject({ kind: "user", text: "Inspect this", images: [
      { status: "available", mediaType: "image/png" },
      { status: "unavailable" },
    ] })
    if (user?.kind !== "user" || user.images?.[0]?.status !== "available") throw new Error("Image reference is missing")
    expect(projectActiveTimelineImage(entries, user.images[0].id)).toEqual({ mediaType: "image/png", data: png })
    expect(projectActiveTimelineImage(entries, "not-a-saved-image")).toBeUndefined()
  })

  it("limits saved image metadata by count and decoded size", () => {
    const oversizedBase64 = "A".repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4)
    const entries = [{
      type: "message", id: "bounded-images", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: [
        { type: "image", mimeType: "image/png", data: oversizedBase64 },
        ...Array.from({ length: 4 }, () => ({ type: "image", mimeType: "image/png", data: "aW1hZ2U=" })),
      ], timestamp: 1 },
    }] as unknown as SessionEntry[]

    const user = projectActiveTimeline(entries)[0]
    expect(user).toMatchObject({ kind: "user", images: [
      { status: "unavailable" },
      { status: "available" },
      { status: "available" },
      { status: "available" },
    ] })
  })

  it("does not serve image data with an invalid signature", () => {
    const entries = [{
      type: "message", id: "invalid-image", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: Buffer.from("not png").toString("base64") }], timestamp: 1 },
    }] as unknown as SessionEntry[]
    const user = projectActiveTimeline(entries)[0]
    if (user?.kind !== "user" || user.images?.[0]?.status !== "available") throw new Error("Image reference is missing")

    expect(projectActiveTimelineImage(entries, user.images[0].id)).toBeUndefined()
  })

  it("reconstructs image references and bytes after reopening saved Pi JSONL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-station-saved-image-"))
    const path = join(directory, "session.jsonl")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const records = [
      { type: "session", version: 3, id: "01900000-0000-4000-8000-000000000001", timestamp: "2026-01-01T00:00:00.000Z", cwd: directory },
      { type: "message", id: "saved-user", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "Saved text" }, { type: "image", mimeType: "image/png", data: png.toString("base64") }], timestamp: 1 } },
    ]
    await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

    try {
      const index = new PublicSessionIndex(directory)
      const session = { id: records[0]!.id, projectId: "project", path, modifiedAt: "2026-01-01T00:00:01.000Z" }
      const user = (await index.timeline(session))[0]
      expect(user).toMatchObject({ kind: "user", text: "Saved text", images: [{ status: "available", mediaType: "image/png" }] })
      if (user?.kind !== "user" || user.images?.[0]?.status !== "available") throw new Error("Saved image reference is missing")
      await expect(index.timelineImage(session, user.images[0].id)).resolves.toEqual({ mediaType: "image/png", data: png })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("projects delegation completion and close lifecycle history as visible tool items", () => {
    const entries = [
      { type: "message", id: "delegate-call", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content: [{ type: "toolCall", id: "call-delegate", name: "delegate_to_agent", arguments: { prompt: "Review" } }] } },
      { type: "message", id: "delegate-started", parentId: "delegate-call", timestamp: "2026-01-01T00:00:01Z", message: { role: "toolResult", toolCallId: "call-delegate", toolName: "delegate_to_agent", content: [{ type: "text", text: "Delegation started" }], isError: false } },
      { type: "custom_message", id: "delegate-completed", parentId: "delegate-started", timestamp: "2026-01-01T00:00:02Z", customType: "pi-station-delegation", content: "Delegation review completed.\n\nAll checks pass.", display: true, details: { kind: "delegation-report", toolCallId: "call-delegate", toolName: "delegate_to_agent", status: "completed" } },
      { type: "message", id: "close-call", parentId: "delegate-completed", timestamp: "2026-01-01T00:00:03Z", message: { role: "assistant", content: [{ type: "toolCall", id: "call-close", name: "close_delegated_agent", arguments: { sessionId: "child-1" } }] } },
      { type: "message", id: "close-result", parentId: "close-call", timestamp: "2026-01-01T00:00:04Z", message: { role: "toolResult", toolCallId: "call-close", toolName: "close_delegated_agent", content: [{ type: "text", text: "Closed delegated agent Session child-1" }], isError: false } },
    ] as unknown as SessionEntry[]

    const timeline = projectActiveTimeline(entries)

    expect(timeline).toEqual([
      expect.objectContaining({ id: "tool-call-call-delegate", kind: "tool", toolCallId: "call-delegate", title: "delegate_to_agent", inputText: JSON.stringify({ prompt: "Review" }), text: "Delegation started", state: "succeeded" }),
      expect.objectContaining({ id: "delegate-completed", kind: "tool", title: "delegate_to_agent · completed", text: "Delegation review completed.\n\nAll checks pass." }),
      expect.objectContaining({ id: "tool-call-call-close", kind: "tool", toolCallId: "call-close", title: "close_delegated_agent", inputText: JSON.stringify({ sessionId: "child-1" }), text: "Closed delegated agent Session child-1", state: "succeeded" }),
    ])
    expect(timeline.some((item) => item.kind === "system")).toBe(false)
  })

  it("keeps two same-name calls separate by stable call identity", () => {
    const entries = [
      { type: "message", id: "calls", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content: [
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "one" } },
        { type: "toolCall", id: "call-2", name: "read", arguments: { path: "two" } },
      ] } },
      { type: "message", id: "result-1", parentId: "calls", timestamp: "2026-01-01T00:00:01Z", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "one" }], isError: false } },
      { type: "message", id: "result-2", parentId: "result-1", timestamp: "2026-01-01T00:00:02Z", message: { role: "toolResult", toolCallId: "call-2", toolName: "read", content: [{ type: "text", text: "two failed" }], isError: true } },
    ] as unknown as SessionEntry[]

    expect(projectActiveTimeline(entries)).toEqual([
      expect.objectContaining({ id: "tool-call-call-1", toolCallId: "call-1", title: "read", text: "one", state: "succeeded" }),
      expect.objectContaining({ id: "tool-call-call-2", toolCallId: "call-2", title: "read", text: "two failed", state: "failed" }),
    ])
  })

  it("projects a Scheduled Job marker and its next user prompt as one entry", () => {
    const entries = [
      { type: "custom_message", id: "job-marker", parentId: null, timestamp: "2026-01-01T00:00:00Z", customType: "pi-station-scheduled-job", content: "Scheduled Job: Daily review", display: true, details: { kind: "scheduled-job", jobId: "job-1", title: "Daily review" } },
      { type: "message", id: "job-prompt", parentId: "job-marker", timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: "Review open work" } },
      { type: "message", id: "normal-user", parentId: "job-prompt", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: "Keep this message" } },
    ] as unknown as SessionEntry[]

    expect(projectActiveTimeline(entries)).toEqual([
      expect.objectContaining({ id: "job-marker", kind: "scheduled-job", jobId: "job-1", title: "Daily review", text: "Review open work" }),
      expect.objectContaining({ id: "normal-user", kind: "user", text: "Keep this message" }),
    ])
  })

  it("does not consume a user prompt when a Scheduled Job marker is incomplete or separated", () => {
    const entries = [
      { type: "custom_message", id: "bad-marker", parentId: null, timestamp: "2026-01-01T00:00:00Z", customType: "pi-station-scheduled-job", content: "Scheduled Job", display: true, details: { kind: "scheduled-job", title: "No ID" } },
      { type: "message", id: "user-1", parentId: "bad-marker", timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: "Visible one" } },
      { type: "custom_message", id: "marker-2", parentId: "user-1", timestamp: "2026-01-01T00:00:02Z", customType: "pi-station-scheduled-job", content: "Scheduled Job: Later", display: true, details: { kind: "scheduled-job", jobId: "job-2", title: "Later" } },
      { type: "custom_message", id: "separator", parentId: "marker-2", timestamp: "2026-01-01T00:00:03Z", customType: "note", content: "Separator", display: true },
      { type: "message", id: "user-2", parentId: "separator", timestamp: "2026-01-01T00:00:04Z", message: { role: "user", content: "Visible two" } },
    ] as unknown as SessionEntry[]

    expect(projectActiveTimeline(entries).filter((item) => item.kind === "user").map((item) => item.text)).toEqual(["Visible one", "Visible two"])
    expect(projectActiveTimeline(entries).some((item) => item.kind === "scheduled-job")).toBe(false)
  })

  it("keeps a Scheduled Job pair together across a history page boundary", () => {
    const entries = [
      ...Array.from({ length: 49 }, (_, index) => ({ type: "message", id: `before-${index}`, parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: `Before ${index}` } })),
      { type: "custom_message", id: "boundary-marker", parentId: null, timestamp: "2026-01-01T00:00:01Z", customType: "pi-station-scheduled-job", content: "Scheduled Job: Boundary", display: true, details: { kind: "scheduled-job", jobId: "job-boundary", title: "Boundary" } },
      { type: "message", id: "boundary-prompt", parentId: "boundary-marker", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: "Boundary prompt" } },
      { type: "message", id: "after", parentId: "boundary-prompt", timestamp: "2026-01-01T00:00:03Z", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
    ] as unknown as SessionEntry[]
    const latest = projectActiveHistory(entries)
    const earlier = projectActiveHistory(entries, latest.before)

    const combined = [...earlier.timeline, ...latest.timeline]
    expect(combined.filter((item) => item.kind === "scheduled-job")).toEqual([
      expect.objectContaining({ id: "boundary-marker", text: "Boundary prompt" }),
    ])
    expect(combined.some((item) => item.id === "boundary-prompt")).toBe(false)
  })

  it("keeps agent messages distinct from user messages", () => {
    const entries = [{
      type: "custom_message", id: "agent-message", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      customType: "pi-station-agent-message", content: "Agent message envelope with reply instructions", display: true,
      details: { kind: "agent-message", fromSessionId: "session-source", fromName: "Themes", message: "Please review this." },
    }] as unknown as SessionEntry[]

    expect(projectActiveTimeline(entries)).toEqual([
      expect.objectContaining({ kind: "agent", fromSessionId: "session-source", fromName: "Themes", text: "Please review this." }),
    ])
  })

  it("keeps unrelated visible custom messages as system history", () => {
    const entries = [{
      type: "custom_message", id: "custom", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      customType: "review", content: "A normal extension message", display: true,
    }] as unknown as SessionEntry[]

    expect(projectActiveTimeline(entries)).toEqual([
      expect.objectContaining({ kind: "system", text: "A normal extension message" }),
    ])
  })

  it("paginates normalized history at exact boundaries without duplicates", () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      type: "message",
      id: `message-${index}`,
      parentId: index === 0 ? null : `message-${index - 1}`,
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: `Question ${index}`, timestamp: index },
    })) as unknown as SessionEntry[]

    const latest = projectActiveHistory(entries)
    const earlier = projectActiveHistory(entries, latest.before)

    expect(latest.timeline).toHaveLength(50)
    expect(latest.hasEarlier).toBe(true)
    expect(earlier.timeline).toHaveLength(50)
    expect(earlier.hasEarlier).toBe(false)
    expect(earlier.before).toBeUndefined()
    expect(new Set([...earlier.timeline, ...latest.timeline].map(({ id }) => id)).size).toBe(100)
  })

  it("rejects a cursor after authoritative history changes", () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({
      type: "message", id: `message-${index}`, parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: `Question ${index}`, timestamp: index },
    })) as unknown as SessionEntry[]
    const cursor = projectActiveHistory(entries).before

    expect(() => projectActiveHistory([...entries, { ...entries[0]!, id: "external-append" }], cursor)).toThrow(StaleHistoryCursorError)
  })

  it("reports no earlier history when the initial page is exact", () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({
      type: "message", id: `message-${index}`, parentId: null, timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: `Question ${index}`, timestamp: index },
    })) as unknown as SessionEntry[]

    expect(projectActiveHistory(entries)).toMatchObject({ hasEarlier: false })
    expect(projectActiveHistory(entries)).not.toHaveProperty("before")
  })

  it("bounds the initial Timeline to the latest 50 items", () => {
    const entries = Array.from({ length: 60 }, (_, index) => ({
      type: "message",
      id: `message-${index}`,
      parentId: index === 0 ? null : `message-${index - 1}`,
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: `Question ${index}`, timestamp: index },
    })) as unknown as SessionEntry[]

    const timeline = projectActiveTimeline(entries)

    expect(timeline).toHaveLength(50)
    expect(timeline[0]?.id).toBe("message-10")
    expect(timeline.at(-1)?.id).toBe("message-59")
  })
})
