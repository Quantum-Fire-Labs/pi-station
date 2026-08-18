import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { IndexedSession, SessionIndex } from "../domain.js"
import { DelegationEvents } from "../delegations.js"
import { createPiStationServer } from "../server.js"
import type { SessionRuntime } from "../session-runtime.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("delegated Session indexing", () => {
  it("lists a working child immediately from its delegation record", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-delegation-index-"))
    roots.push(dataDir)
    const indexed = new Map<string, IndexedSession>()
    const indexSession = vi.fn((session: IndexedSession) => {
      indexed.set(`${session.projectId}:${session.id}`, session)
      return Promise.resolve(session)
    })
    const refreshSession = vi.fn(() => Promise.resolve(undefined))
    const index: SessionIndex = {
      list: () => Promise.resolve([...indexed.values()]),
      get: (key) => Promise.resolve(indexed.get(`${key.projectId}:${key.sessionId}`)),
      indexSession,
      refreshSession,
      timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
      timelineImage: () => Promise.resolve(undefined),
      rename: (session, name) => Promise.resolve({ ...session, name }),
    }
    const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
    const delegationEvents = new DelegationEvents()
    const server = createPiStationServer({ dataDir, index, runner, delegationEvents })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("No address")
    const base = `http://127.0.0.1:${address.port}`

    try {
      const projectResponse = await fetch(`${base}/v2/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: dataDir }),
      })
      const projectBody = (await projectResponse.json()) as { projects: Array<{ id: string }> }
      const projectId = projectBody.projects[0]!.id
      indexed.set(`${projectId}:parent-1`, {
        id: "parent-1",
        projectId,
        path: "/sessions/parent-1.jsonl",
        name: "Parent",
        modifiedAt: "2026-06-01T00:00:00.000Z",
      })

      const record = {
        id: "delegation-1",
        projectId,
        parentSessionId: "parent-1",
        childSessionId: "child-1",
        childPath: "/sessions/child-1.jsonl",
        name: "Child",
        status: "working" as const,
        createdAt: "2026-06-10T12:00:00.000Z",
        updatedAt: "2026-06-10T12:00:00.000Z",
      }
      delegationEvents.publish({ type: "started", record })

      await vi.waitFor(async () => {
        const response = await fetch(`${base}/v2/sessions`)
        const body = (await response.json()) as { sequence: number; sessions: Array<Record<string, unknown>> }
        expect(body.sequence).toBe(1)
        expect(body.sessions).toContainEqual(expect.objectContaining({
          id: "child-1",
          projectId,
          path: "/sessions/child-1.jsonl",
          name: "Child",
          state: "open",
          parentSessionId: "parent-1",
          delegationStatus: "working",
        }))
      })
      expect(indexSession).toHaveBeenCalledWith(expect.objectContaining({ id: "child-1", path: "/sessions/child-1.jsonl" }))
      expect(refreshSession).not.toHaveBeenCalled()

      delegationEvents.publishTurn({ type: "started", record })
      delegationEvents.publishTurn({ type: "runtime-event", record, event: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Inspect" } } })
      delegationEvents.publishTurn({ type: "runtime-event", record, event: { type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "README.md" } } })
      delegationEvents.publishTurn({ type: "runtime-event", record, event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Ready" } } })
      delegationEvents.publishTurn({ type: "runtime-event", record, event: { type: "sdk_private", value: "not-on-wire" } })

      const controller = new AbortController()
      const response = await fetch(`${base}/v2/projects/${projectId}/sessions/child-1/events`, { signal: controller.signal })
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error("No event stream")
      let streamed = ""
      while (!streamed.includes("assistant.delta")) {
        const chunk = await reader.read()
        if (chunk.done) break
        streamed += new TextDecoder().decode(chunk.value)
      }
      controller.abort()
      expect(streamed).toContain('"phase":"working"')
      expect(streamed).toContain('"type":"thinking.delta"')
      expect(streamed).toContain('"type":"tool"')
      expect(streamed).toContain('"type":"assistant.delta"')
      expect(streamed).not.toContain("sdk_private")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
