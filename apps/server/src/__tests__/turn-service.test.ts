import { describe, expect, it, vi } from "vitest"
import type { SessionRuntime, StartRuntimeTurn } from "../session-runtime.js"
import type { SavedSession, StreamEvent } from "@pi-station/application-protocol"
import type { IndexedSession, SessionIndex } from "../domain.js"
import { normalizeAttentionCandidate, normalizeRpcEvent, TurnService, type NormalizedSessionAttention } from "../turn-service.js"

const session: SavedSession = { id: "s1", projectId: "p1", path: "/sessions/s1.jsonl", modifiedAt: "2026-01-01T00:00:00.000Z", state: "open" }

describe("TurnService", () => {
  it("normalizes live tool input, updates, and completion with stable identity", () => {
    expect(normalizeAttentionCandidate({ type: "turn_end", message: { role: "assistant", stopReason: "stop", content: [
      { type: "thinking", thinking: "private" },
      { type: "text", text: "Visible answer" },
      { type: "toolResult", content: "private tool result" },
    ] } })).toEqual({ kind: "completed", text: "Visible answer" })
    expect(normalizeAttentionCandidate({ type: "turn_end", message: { role: "assistant", stopReason: "aborted", content: [] } })).toEqual({ kind: "needs-attention" })
    expect(normalizeRpcEvent({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } })).toEqual({
      version: 2, type: "tool", toolCallId: "call-1", title: "bash", inputText: "{\n  \"command\": \"pwd\"\n}", state: "running",
    })
    expect(normalizeRpcEvent({ type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", args: {}, partialResult: { content: [{ type: "text", text: "/project" }] } })).toEqual({
      version: 2, type: "tool", toolCallId: "call-1", title: "bash", outputText: "/project", state: "running",
    })
    expect(normalizeRpcEvent({ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "/project" }] }, isError: false })).toEqual({
      version: 2, type: "tool", toolCallId: "call-1", title: "bash", outputText: "/project", state: "succeeded",
    })
  })
  it("streams normalized output and refreshes the saved Timeline before Idle", async () => {
    let settle!: () => void
    const completion = new Promise<{ sessionId: string; promptAccepted: true; settled: true }>((resolve) => { settle = () => resolve({ sessionId: "s1", promptAccepted: true, settled: true }) })
    const runner: SessionRuntime = { run: vi.fn((input: StartRuntimeTurn) => {
      input.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } })
      input.onEvent?.({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "README.md" } })
      input.onEvent?.({ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: [{ type: "text", text: "Done" }] } })
      input.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " again" } })
      input.onEvent?.({ type: "turn_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Hello again" }] } })
      return { completion, ownershipLost: new Promise<never>(() => undefined), steer: () => Promise.resolve(), followUp: () => Promise.resolve(), abort: () => Promise.resolve(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() }
    }), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() }
    const index: SessionIndex = {
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.resolve(undefined)),
      indexSession: vi.fn((saved: IndexedSession) => Promise.resolve(saved)),
      refreshSession: vi.fn(() => Promise.resolve(undefined)),
      timeline: vi.fn(() => Promise.resolve([{ id: "a", kind: "assistant" as const, text: "Hello" }])),
      historyPage: vi.fn(() => Promise.resolve({ version: 2 as const, revision: "history-a", hasEarlier: false, timeline: [{ id: "a", kind: "assistant" as const, text: "Hello" }] })),
      timelineImage: vi.fn(() => Promise.resolve(undefined)),
      rename: vi.fn((saved: IndexedSession, name: string) => Promise.resolve({ ...saved, name })),
    }
    const events: StreamEvent[] = []
    const attention = vi.fn<(input: NormalizedSessionAttention) => void>()
    const service = new TurnService(runner, (_id, event) => events.push(event), attention, "test-epoch")
    const input = { projectId: session.projectId, sessionId: session.id, cwd: "/project", prompt: "Go", mode: "existing" as const, settledTimeline: () => index.timeline(session) }

    expect(service.start(input)).toBe(true)
    expect(service.start(input)).toBe(false)
    expect(service.isWorking(input)).toBe(true)
    expect(service.workingCount).toBe(1)
    settle()
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ version: 2, type: "phase", phase: "idle", epoch: "test-epoch", generation: 2 }))
    expect(events.map(({ type }) => type)).toEqual(["phase", "assistant.delta", "tool", "tool", "assistant.delta", "timeline", "phase"])
    expect(attention).toHaveBeenCalledOnce()
    expect(attention.mock.calls[0]?.[0]).toMatchObject({ projectId: "p1", sessionId: "s1", kind: "completed", text: "Hello again" })
    expect(attention.mock.calls[0]?.[0].id).toMatch(/^[0-9a-f-]+$/u)
  })

  it("streams normalized delegated child activity and settles its Timeline before Idle", async () => {
    let settleTimeline!: (items: readonly { id: string; kind: "assistant"; text: string }[]) => void
    const timeline = new Promise<readonly { id: string; kind: "assistant"; text: string }[]>((resolve) => { settleTimeline = resolve })
    const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
    const events: StreamEvent[] = []
    const service = new TurnService(runner, (_key, event) => events.push(event), () => undefined, "test-epoch")
    const key = { projectId: "p1", sessionId: "child-1" }

    service.delegatedStarted(key)
    service.delegatedEvent(key, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Plan" } })
    service.delegatedEvent(key, { type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "README.md" } })
    service.delegatedEvent(key, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Done" } })
    service.delegatedEvent(key, { type: "turn_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done" }] } })
    service.delegatedEvent(key, { type: "raw_sdk_only", secret: "must not cross" })
    const finished = service.delegatedFinished({ key, settledTimeline: () => timeline })

    expect(service.isWorking(key)).toBe(true)
    expect(events.map(({ type }) => type)).toEqual(["phase", "thinking.delta", "tool", "assistant.delta"])
    expect(JSON.stringify(events)).not.toContain("raw_sdk_only")
    settleTimeline([{ id: "assistant-1", kind: "assistant", text: "Done" }])
    await finished
    expect(service.isWorking(key)).toBe(false)
    expect(events.map(({ type }) => type)).toEqual(["phase", "thinking.delta", "tool", "assistant.delta", "timeline", "phase"])
    expect(events.at(-1)).toEqual({ version: 2, type: "phase", phase: "idle", epoch: "test-epoch", generation: 2 })
  })

  it("publishes generic attention for a failed turn without exposing the failure", async () => {
    const runner: SessionRuntime = {
      run: vi.fn(() => ({
        completion: Promise.reject(new Error("private provider failure")),
        ownershipLost: new Promise<never>(() => undefined),
        steer: () => Promise.resolve(), followUp: () => Promise.resolve(), abort: () => Promise.resolve(), control: vi.fn(),
      })),
      control: vi.fn(),
      interruptOwned: vi.fn(),
      dispose: vi.fn(),
    }
    const attention = vi.fn<(input: NormalizedSessionAttention) => void>()
    const service = new TurnService(runner, () => undefined, attention)
    service.start({ projectId: "p1", sessionId: "failed", cwd: "/project", prompt: "private prompt", mode: "new", settledTimeline: () => Promise.resolve([]) })
    await vi.waitFor(() => expect(attention).toHaveBeenCalled())
    expect(attention).toHaveBeenCalledWith(expect.objectContaining({ kind: "needs-attention" }))
    expect(JSON.stringify(attention.mock.calls)).not.toContain("private provider failure")
    expect(JSON.stringify(attention.mock.calls)).not.toContain("private prompt")
  })

  it("routes settings through an active child and uses an idle control otherwise", async () => {
    const activeControl = vi.fn(() => Promise.resolve({ type: "response" as const, command: "set_model", success: true }))
    const idleControl = vi.fn(() => Promise.resolve({ type: "response" as const, command: "get_state", success: true }))
    const runner: SessionRuntime = {
      run: vi.fn(() => ({ completion: new Promise<{ sessionId: string; promptAccepted: true; settled: true }>(() => undefined), ownershipLost: new Promise<never>(() => undefined), steer: () => Promise.resolve(), followUp: () => Promise.resolve(), abort: () => Promise.resolve(), control: activeControl })),
      control: idleControl,
      interruptOwned: vi.fn(),
      dispose: vi.fn(),
    }
    const service = new TurnService(runner, () => undefined)
    const active = { projectId: "p1", sessionId: "open" }
    service.start({ ...active, cwd: "/project", prompt: "Go", mode: "existing", settledTimeline: () => Promise.resolve([]) })
    await service.control(active, "/sessions/active.jsonl", "/project", { type: "set_model", provider: "openai", modelId: "gpt-test" })
    await service.control({ projectId: "p1", sessionId: "idle" }, "/sessions/idle.jsonl", "/project", { type: "get_state" })
    expect(activeControl).toHaveBeenCalledWith({ type: "set_model", provider: "openai", modelId: "gpt-test" })
    expect(idleControl).toHaveBeenCalledWith({ projectId: "p1", sessionId: "idle", sessionPath: "/sessions/idle.jsonl", cwd: "/project", command: { type: "get_state" } })
  })

  it("reports SDK steering rejection before accepting the command", async () => {
    const failure = new Error("Steering input was rejected")
    const runner: SessionRuntime = {
      run: vi.fn(() => ({
        completion: new Promise(() => undefined),
        ownershipLost: new Promise<never>(() => undefined),
        steer: () => Promise.reject(failure),
        followUp: () => Promise.resolve(),
        abort: () => Promise.resolve(),
        control: vi.fn(),
      })),
      control: vi.fn(),
      interruptOwned: vi.fn(),
      dispose: vi.fn(),
    }
    const service = new TurnService(runner, () => undefined)
    const key = { projectId: "p1", sessionId: "open" }
    service.start({ ...key, cwd: "/project", prompt: "Go", mode: "existing", settledTimeline: () => Promise.resolve([]) })

    await expect(service.steer(key, "Change direction")).rejects.toBe(failure)
  })

  it("releases activeTurns only after explicit generation-scoped ownership loss", async () => {
    let lose!: (error: Error) => void
    const ownershipLost = new Promise<never>((_resolve, reject) => { lose = reject })
    const runner: SessionRuntime = {
      run: vi.fn(() => ({ completion: new Promise(() => undefined), ownershipLost, steer: vi.fn(), followUp: vi.fn(), abort: vi.fn(), control: vi.fn() })),
      control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn(),
    }
    const events: StreamEvent[] = []
    const service = new TurnService(runner, (_key, event) => events.push(event))
    const input = { projectId: "p1", sessionId: "lost-parent", cwd: "/project", prompt: "first", mode: "existing" as const, settledTimeline: () => Promise.resolve([]) }

    expect(service.start(input)).toBe(true)
    expect(service.workingCount).toBe(1)
    lose(new Error("owned runtime replaced"))
    await vi.waitFor(() => expect(service.workingCount).toBe(0))
    expect(events.filter((event) => event.type === "phase").map((event) => event.type === "phase" && event.phase)).toEqual(["working", "idle"])
    service.dispose()
  })

  it("suppresses old generation events after explicit loss and replacement", async () => {
    let loseOld!: (error: Error) => void
    const oldLost = new Promise<never>((_resolve, reject) => { loseOld = reject })
    const runtimeInputs: StartRuntimeTurn[] = []
    const runner: SessionRuntime = {
      run: vi.fn((input: StartRuntimeTurn) => {
        runtimeInputs.push(input)
        return { completion: new Promise(() => undefined), ownershipLost: runtimeInputs.length === 1 ? oldLost : new Promise<never>(() => undefined), steer: vi.fn(), followUp: vi.fn(), abort: vi.fn(), control: vi.fn() }
      }),
      control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn(),
    }
    const events: StreamEvent[] = []
    const service = new TurnService(runner, (_key, event) => events.push(event))
    const input = { projectId: "p1", sessionId: "race", cwd: "/project", prompt: "first", mode: "existing" as const, settledTimeline: () => Promise.resolve([]) }
    service.start(input)
    loseOld(new Error("replaced"))
    await vi.waitFor(() => expect(service.isWorking(input)).toBe(false))
    service.start({ ...input, prompt: "replacement" })
    runtimeInputs[0]?.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "late" } })

    expect(events).not.toContainEqual(expect.objectContaining({ type: "assistant.delta", text: "late" }))
    expect(service.isWorking(input)).toBe(true)
    expect(events.filter((event) => event.type === "timeline")).toHaveLength(0)
    service.dispose()
  })

  it("routes steering, follow-up, queue clearing, and abort through the active turn", async () => {
    const abort = vi.fn(() => Promise.resolve())
    const clearQueue = vi.fn(() => Promise.resolve())
    const steer = vi.fn(() => Promise.resolve())
    const followUp = vi.fn(() => Promise.resolve())
    const control = vi.fn()
    const run = vi.fn(() => ({ completion: new Promise<{ sessionId: string; promptAccepted: true; settled: true }>(() => undefined), ownershipLost: new Promise<never>(() => undefined), steer, followUp, clearQueue, abort, control }))
    const runner: SessionRuntime = { run, control, interruptOwned: vi.fn(), dispose: vi.fn() }
    const service = new TurnService(runner, () => undefined)
    expect(service.start({ projectId: "p1", sessionId: "new", cwd: "/project", prompt: "Go", mode: "new", name: "Named", settledTimeline: () => Promise.resolve([]) })).toBe(true)
    const key = { projectId: "p1", sessionId: "new" }
    await expect(service.steer(key, "Change direction")).resolves.toBe(true)
    await expect(service.followUp(key, "Then verify")).resolves.toBe(true)
    expect(steer).toHaveBeenCalledWith("Change direction")
    expect(followUp).toHaveBeenCalledWith("Then verify")
    await expect(service.clearQueue(key)).resolves.toBe(true)
    expect(clearQueue).toHaveBeenCalledOnce()
    await expect(service.abort(key)).resolves.toBe(true)
    expect(abort).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "new", session: "new", name: "Named" }))
  })
})
