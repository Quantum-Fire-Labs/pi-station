import { describe, expect, it, vi } from "vitest"
import { CLOSE_DELEGATED_AGENT_TOOL_NAME, createSdkSessionRuntime, DELEGATED_SESSION_EXCLUDED_TOOLS, DELEGATION_TOOL_NAME, delegatedSessionSettings, deliverDelegationReport, MAX_ACTIVE_DELEGATIONS_PER_SESSION, RECOVER_DELEGATED_AGENT_TOOL_NAME, type RuntimeEvent, type RuntimeSession } from "../session-runtime.js"

function fakeSession(entries: readonly Record<string, unknown>[] = []) {
  let listener: ((event: RuntimeEvent) => void) | undefined
  let model = { provider: "openai", id: "gpt-a", name: "GPT A", reasoning: true }
  let thinkingLevel = "medium"
  const models = [model, { provider: "openai", id: "gpt-b", name: "GPT B", reasoning: true }]
  const session = {
    abort: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
    followUp: vi.fn(() => Promise.resolve()),
    getAvailableThinkingLevels: vi.fn(() => ["off", "low", "medium", "high"]),
    get isStreaming() { return false },
    get model() { return model },
    messages: [],
    modelRuntime: {
      getAvailableSnapshot: vi.fn(() => models),
      getModel: vi.fn((provider: string, id: string) => models.find((item) => item.provider === provider && item.id === id)),
    },
    reload: vi.fn(() => Promise.resolve()),
    prompt: vi.fn(() => {
      listener?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } })
      return Promise.resolve()
    }),
    sendCustomMessage: vi.fn(() => Promise.resolve()),
    sessionManager: { appendCustomEntry: vi.fn(), appendSessionInfo: vi.fn(), getBranch: vi.fn(() => entries) },
    setModel: vi.fn((next: typeof model) => { model = next; return Promise.resolve() }),
    setThinkingLevel: vi.fn((next: string) => { thinkingLevel = next }),
    steer: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn((next: (event: RuntimeEvent) => void) => { listener = next; return () => { listener = undefined } }),
    get thinkingLevel() { return thinkingLevel },
  }
  return session as unknown as RuntimeSession
}

describe("SDK Session runtime", () => {
  it("uses the Pi Station delegation name and isolates child coordination tools", () => {
    expect(DELEGATION_TOOL_NAME).toBe("delegate_to_agent")
    expect(CLOSE_DELEGATED_AGENT_TOOL_NAME).toBe("close_delegated_agent")
    expect(RECOVER_DELEGATED_AGENT_TOOL_NAME).toBe("recover_delegated_agent")
    expect(MAX_ACTIVE_DELEGATIONS_PER_SESSION).toBe(20)
    expect(DELEGATED_SESSION_EXCLUDED_TOOLS).toEqual([
      "delegate_to_agent",
      "close_delegated_agent",
      "recover_delegated_agent",
      "delegate_to_background_agent",
      "delegate_to_interactive_agent",
      "list_agents",
      "resume_agent",
    ])
  })

  it("uses Pi Station defaults for a delegated child Session when no overrides are present", () => {
    const defaults = { provider: "openai-codex", modelId: "gpt-default", thinkingLevel: "medium" as const }

    expect(delegatedSessionSettings(defaults, {})).toEqual(defaults)
  })

  it("applies optional model and thinking-level overrides to a delegated child Session", () => {
    const defaults = { provider: "openai-codex", modelId: "gpt-default", thinkingLevel: "medium" as const }

    expect(delegatedSessionSettings(defaults, {
      model: { provider: "anthropic", modelId: "claude-sonnet" },
      thinkingLevel: "high",
    })).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet",
      thinkingLevel: "high",
    })
  })

  it("limits Sol delegated Sessions to medium thinking", () => {
    const defaults = { provider: "openai-codex", modelId: "gpt-default", thinkingLevel: "high" as const }

    expect(delegatedSessionSettings(defaults, {
      model: { provider: "openai-codex", modelId: "gpt-5.6-sol" },
      thinkingLevel: "max",
    })).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.6-sol",
      thinkingLevel: "medium",
    })
  })

  it("writes a completed child response through the parent SDK Session as a visible tool-linked follow-up", async () => {
    const session = fakeSession()

    await deliverDelegationReport(session, "delegate-call-1", {
      status: "completed",
      message: "Delegation review completed.\n\nAll checks pass.",
    })

    expect(session.sendCustomMessage).toHaveBeenCalledWith({
      customType: "pi-station-delegation",
      content: "Delegation review completed.\n\nAll checks pass.",
      display: true,
      details: {
        kind: "delegation-report",
        toolCallId: "delegate-call-1",
        toolName: "delegate_to_agent",
        status: "completed",
      },
    }, { triggerTurn: true, deliverAs: "followUp" })
  })

  it("writes a failed child response with failed tool history metadata", async () => {
    const session = fakeSession()

    await deliverDelegationReport(session, "delegate-call-2", {
      status: "failed",
      message: "Delegation review failed: stopped",
    })

    expect(session.sendCustomMessage).toHaveBeenCalledWith({
      customType: "pi-station-delegation",
      content: "Delegation review failed: stopped",
      display: true,
      details: {
        kind: "delegation-report",
        toolCallId: "delegate-call-2",
        toolName: "delegate_to_agent",
        status: "failed",
      },
    }, { triggerTurn: true, deliverAs: "followUp" })
  })

  it("creates one injected SDK Session and streams its typed events without a process", async () => {
    const session = fakeSession()
    const factory = vi.fn(() => Promise.resolve(session))
    const runtime = createSdkSessionRuntime(factory)
    const events: RuntimeEvent[] = []
    const turn = runtime.run({ projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", session: "existing", cwd: "/project", prompt: "Go", onEvent: (event) => events.push(event) })
    await turn.completion
    await runtime.control({ projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", cwd: "/project", command: { type: "get_state" } })
    expect(factory).toHaveBeenCalledOnce()
    expect(session.prompt).toHaveBeenCalledWith("Go")
    expect(events).toEqual([expect.objectContaining({ type: "message_update" })])
    runtime.dispose()
    await vi.waitFor(() => expect(session.dispose).toHaveBeenCalledOnce())
  })

  it("owns an accepted prompt before streaming starts and through model and tool pauses", async () => {
    const session = fakeSession()
    let streaming = false
    let finishPrompt!: () => void
    Object.defineProperty(session, "isStreaming", { get: () => streaming })
    vi.mocked(session.prompt).mockImplementation(() => new Promise<void>((resolve) => { finishPrompt = resolve }))
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))

    const turn = runtime.run({ projectId: "p1", sessionId: "lifecycle", sessionPath: "/sessions/lifecycle.jsonl", session: "existing", cwd: "/project", prompt: "Go" })
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledOnce())

    streaming = true
    streaming = false

    finishPrompt()
    await turn.completion
  })

  it("releases prompt ownership after abort settles the injected prompt", async () => {
    const session = fakeSession()
    let settlePrompt!: () => void
    vi.mocked(session.prompt).mockImplementation(() => new Promise<void>((resolve) => { settlePrompt = resolve }))
    vi.mocked(session.abort).mockImplementation(() => { settlePrompt(); return Promise.resolve() })
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))
    const turn = runtime.run({ projectId: "p1", sessionId: "abort", sessionPath: "/sessions/abort.jsonl", session: "existing", cwd: "/project", prompt: "Go" })

    await turn.abort()
    await turn.completion
  })

  it("rejects an unsettled prompt when its owning runtime is disposed", async () => {
    const session = fakeSession()
    vi.mocked(session.prompt).mockImplementation(() => new Promise<void>(() => undefined))
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))
    const turn = runtime.run({ projectId: "p1", sessionId: "lost", sessionPath: "/sessions/lost.jsonl", session: "existing", cwd: "/project", prompt: "Go" })

    runtime.dispose()
    await expect(turn.completion).rejects.toThrow("disconnected")
  })

  it("delivers base64 images through the public SDK prompt options", async () => {
    const session = fakeSession()
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))
    const turn = runtime.run({
      projectId: "p1",
      sessionId: "s1",
      sessionPath: "/sessions/s1.jsonl",
      session: "existing",
      cwd: "/project",
      prompt: "Inspect this",
      images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }],
    })
    await turn.completion
    expect(session.prompt).toHaveBeenCalledWith("Inspect this", {
      images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
    })
  })

  it("uses SDK controls and writes the requested ID and name for a new Session", async () => {
    const session = fakeSession()
    const factory = vi.fn(() => Promise.resolve(session))
    const runtime = createSdkSessionRuntime(factory)
    const turn = runtime.run({ projectId: "p1", sessionId: "generated-id", session: "new", cwd: "/project", prompt: "Go", name: "Named" })
    await turn.control({ type: "set_model", provider: "openai", modelId: "gpt-b" })
    await turn.control({ type: "set_thinking_level", level: "high" })
    await turn.completion
    expect(factory).toHaveBeenCalledWith({ projectId: "p1", sessionId: "generated-id", cwd: "/project", mode: "new" })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(session.sessionManager.appendSessionInfo).toHaveBeenCalledWith("Named")
    expect(session.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gpt-b" }))
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high")
    expect(session.reload).not.toHaveBeenCalled()
  })

  it("applies saved defaults to new and placeholder SDK Sessions but not opened Sessions", async () => {
    const newSession = fakeSession()
    const placeholderSession = fakeSession([{ type: "custom", customType: "pi-station-empty-session" }])
    const openedSession = fakeSession()
    const factory = vi.fn()
      .mockResolvedValueOnce(newSession)
      .mockResolvedValueOnce(placeholderSession)
      .mockResolvedValueOnce(openedSession)
    const sessionDefaults = vi.fn(() => Promise.resolve({
      provider: "openai",
      modelId: "gpt-b",
      thinkingLevel: "high" as const,
    }))
    const runtime = createSdkSessionRuntime(factory, { sessionDefaults })

    await runtime.run({ projectId: "p1", sessionId: "new-id", session: "new", cwd: "/project", prompt: "Fake prompt" }).completion
    await runtime.control({ projectId: "p1", sessionId: "placeholder-id", sessionPath: "/sessions/placeholder.jsonl", cwd: "/project", command: { type: "get_state" } })
    await runtime.control({ projectId: "p1", sessionId: "opened-id", sessionPath: "/sessions/opened.jsonl", cwd: "/project", command: { type: "get_state" } })

    expect(sessionDefaults).toHaveBeenCalledTimes(2)
    expect(newSession.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gpt-b" }))
    expect(newSession.setThinkingLevel).toHaveBeenCalledWith("high")
    expect(placeholderSession.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gpt-b" }))
    expect(placeholderSession.setThinkingLevel).toHaveBeenCalledWith("high")
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(placeholderSession.sessionManager.appendCustomEntry).toHaveBeenCalledWith("pi-station-session-defaults-applied")
    expect(openedSession.setModel).not.toHaveBeenCalled()
    expect(openedSession.setThinkingLevel).not.toHaveBeenCalled()
  })

  it("replaces an idle SDK Session on reload and preserves its Pi Session identity", async () => {
    const original = fakeSession()
    const replacement = fakeSession()
    const factory = vi.fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(replacement)
    const runtime = createSdkSessionRuntime(factory)

    await runtime.control({ projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", cwd: "/project", command: { type: "get_state" } })
    await runtime.control({ projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", cwd: "/project", command: { type: "reload" } })

    expect(original.dispose).toHaveBeenCalledOnce()
    expect(original.reload).not.toHaveBeenCalled()
    expect(factory).toHaveBeenNthCalledWith(2, {
      projectId: "p1",
      sessionId: "s1",
      sessionPath: "/sessions/s1.jsonl",
      cwd: "/project",
      mode: "existing",
    })
    await runtime.control({ projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", cwd: "/project", command: { type: "get_state" } })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("recovers the same saved child Session once through an injected SDK runtime", async () => {
    const session = fakeSession()
    let finishPrompt: (() => void) | undefined
    vi.mocked(session.prompt).mockImplementation(() => new Promise<void>((resolve) => { finishPrompt = resolve }))
    const factory = vi.fn(() => Promise.resolve(session))
    const events: string[] = []
    const reports: Array<{ status: "completed" | "failed"; message: string }> = []
    const runtime = createSdkSessionRuntime(factory, {
      delegationEvents: {
        publish: vi.fn((event: { type: string }) => events.push(event.type)),
        publishTurn: vi.fn(),
      } as never,
    })
    const record = {
      id: "delegation-1", projectId: "p1", parentSessionId: "parent-1", childSessionId: "child-1",
      childPath: "/sessions/child-1.jsonl", status: "interrupted" as const,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:01:00Z",
    }

    const recover = runtime.recoverDelegation
    if (recover === undefined) throw new Error("Recovery action is unavailable")
    const working = await recover({ record, cwd: "/project-worktree", prompt: "Continue safely", onComplete: (report) => { reports.push(report); return Promise.resolve() } })
    await expect(recover({ record, cwd: "/project-worktree", prompt: "Duplicate", onComplete: () => Promise.resolve() }))
      .rejects.toThrow("recovery is already in progress")

    expect(working).toMatchObject({ id: "delegation-1", childSessionId: "child-1", status: "working" })
    expect(factory).toHaveBeenCalledWith({
      projectId: "p1", sessionId: "child-1", sessionPath: "/sessions/child-1.jsonl",
      cwd: "/project-worktree", mode: "existing", delegated: true,
    })
    expect(session.setModel).not.toHaveBeenCalled()
    expect(session.setThinkingLevel).not.toHaveBeenCalled()
    expect(session.prompt).toHaveBeenCalledWith("Continue safely")
    expect(events).toEqual(["started"])

    finishPrompt?.()
    await vi.waitFor(() => expect(reports).toEqual([expect.objectContaining({ status: "completed" })]))
    expect(events).toEqual(["started", "completed"])
  })

  it("rejects completed delegated Sessions before it acquires a runtime", async () => {
    const factory = vi.fn(() => Promise.resolve(fakeSession()))
    const runtime = createSdkSessionRuntime(factory)
    const recover = runtime.recoverDelegation
    if (recover === undefined) throw new Error("Recovery action is unavailable")
    await expect(recover({
      record: {
        id: "delegation-1", projectId: "p1", parentSessionId: "parent-1", childSessionId: "child-1",
        childPath: "/sessions/child-1.jsonl", status: "completed",
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:01:00Z",
      },
      cwd: "/project", prompt: "Continue", onComplete: () => Promise.resolve(),
    })).rejects.toThrow("Only a failed, cancelled, or interrupted")
    expect(factory).not.toHaveBeenCalled()
  })

  it("delivers inbound agent messages as custom messages instead of user prompts", async () => {
    const session = fakeSession()
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))
    await runtime.run({
      projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", session: "existing", cwd: "/project", prompt: "ignored",
      agentMessage: { fromSessionId: "source", fromName: "Themes", message: "Please review this." },
    }).completion

    expect(session.prompt).not.toHaveBeenCalled()
    expect(session.sendCustomMessage).toHaveBeenCalledWith({
      customType: "pi-station-agent-message",
      content: "Please review this.",
      display: true,
      details: { kind: "agent-message", fromSessionId: "source", fromName: "Themes" },
    }, { triggerTurn: true })
  })

  it("steers an agent message into a working Session owned directly by the SDK runtime", async () => {
    const session = fakeSession()
    Object.defineProperty(session, "isStreaming", { get: () => true })
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))
    const turn = runtime.run({ projectId: "p1", sessionId: "child", sessionPath: "/sessions/child.jsonl", session: "existing", cwd: "/project", prompt: "Work" })

    await expect(runtime.sendAgentMessage?.({
      sessionId: "child",
      cwd: "/project",
      message: { fromSessionId: "parent", message: "Change direction." },
    })).resolves.toBe(true)
    expect(session.sendCustomMessage).toHaveBeenCalledWith({
      customType: "pi-station-agent-message",
      content: "Change direction.",
      display: true,
      details: { kind: "agent-message", fromSessionId: "parent" },
    }, { triggerTurn: true, deliverAs: "steer" })
    await expect(runtime.deliver?.({ sessionId: "child", cwd: "/project", delivery: "followUp", message: "Then summarize." })).resolves.toBe(true)
    expect(session.followUp).toHaveBeenCalledWith("Then summarize.")
    await expect(runtime.abortSession?.({ sessionId: "child", cwd: "/project" })).resolves.toBe(true)
    expect(session.abort).toHaveBeenCalledOnce()
    await turn.completion
  })

  it("routes active-turn input and abort through the same SDK Session", async () => {
    const session = fakeSession()
    const runtime = createSdkSessionRuntime(() => Promise.resolve(session))
    const turn = runtime.run({ projectId: "p1", sessionId: "s1", sessionPath: "/sessions/s1.jsonl", session: "existing", cwd: "/project", prompt: "Go" })
    await turn.steer("Change direction")
    await turn.followUp("Then verify")
    await turn.abort()
    await turn.completion
    await vi.waitFor(() => {
      expect(session.steer).toHaveBeenCalledWith("Change direction")
      expect(session.followUp).toHaveBeenCalledWith("Then verify")
      expect(session.abort).toHaveBeenCalledOnce()
    })
  })
})
