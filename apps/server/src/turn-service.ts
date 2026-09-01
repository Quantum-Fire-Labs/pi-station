import { randomUUID } from "node:crypto"
import type {
  RuntimeAgentMention,
  RuntimeAgentMessage,
  RuntimeControlCommand,
  RuntimeResponse,
  RuntimeEvent,
  RuntimePromptImage,
  RuntimeTurn,
  SessionRuntime,
} from "./session-runtime.js"
import type {
  SessionKey,
  StreamEvent,
  TimelineItem,
} from "@pi-station/application-protocol"

export type Publish = (key: SessionKey, event: StreamEvent) => void

export interface NormalizedSessionAttention extends SessionKey {
  readonly id: string
  readonly kind: "completed" | "needs-attention"
  readonly text?: string
}

export type PublishAttention = (attention: NormalizedSessionAttention) => Promise<void> | void

type AttentionCandidate = Pick<NormalizedSessionAttention, "kind" | "text">

export interface StartTurn extends SessionKey {
  readonly cwd: string
  readonly prompt: string
  readonly images?: readonly RuntimePromptImage[]
  readonly mode: "existing" | "new"
  readonly sessionPath?: string
  readonly name?: string
  readonly origin?: { readonly kind: "scheduled-job"; readonly jobId: string; readonly title: string }
  readonly attachmentMarker?: unknown
  readonly agentMentions?: readonly RuntimeAgentMention[]
  readonly agentMessage?: RuntimeAgentMessage
  readonly settledTimeline: () => Promise<readonly TimelineItem[]>
}

interface ActiveTurn {
  readonly turn: RuntimeTurn
  readonly key: SessionKey
  readonly generation: number
}

export class TurnService {
  readonly #active = new Map<string, ActiveTurn>()
  readonly #attentionCandidates = new Map<string, AttentionCandidate>()
  readonly #attentionIds = new Map<string, string>()
  readonly #delegated = new Set<string>()
  readonly #runner: SessionRuntime
  readonly #publish: Publish
  readonly #publishAttention: PublishAttention
  readonly #phaseGenerations = new Map<string, number>()
  readonly #phaseEpoch: string
  readonly #idleWaiters = new Set<() => void>()
  readonly #sessionIdleListeners = new Set<(key: SessionKey) => void>()

  constructor(runner: SessionRuntime, publish: Publish, publishAttention: PublishAttention = () => undefined, phaseEpoch: string = randomUUID()) {
    this.#runner = runner
    this.#publish = publish
    this.#publishAttention = publishAttention
    this.#phaseEpoch = phaseEpoch
  }

  dispose(): void { this.#idleWaiters.clear(); this.#sessionIdleListeners.clear() }

  onSessionIdle(listener: (key: SessionKey) => void): () => void {
    this.#sessionIdleListeners.add(listener)
    return () => this.#sessionIdleListeners.delete(listener)
  }

  phase(key: SessionKey): { readonly phase: "working" | "idle"; readonly epoch: string; readonly generation: number } {
    const id = key.sessionId
    return {
      phase: this.#active.has(id) || this.#delegated.has(id) ? "working" : "idle",
      epoch: this.#phaseEpoch,
      generation: this.#phaseGenerations.get(id) ?? 0,
    }
  }

  isWorking(key: SessionKey): boolean { return this.phase(key).phase === "working" }

  get workingCount(): number { return new Set([...this.#active.keys(), ...this.#delegated]).size }

  async drain(timeoutMs: number): Promise<boolean> {
    if (this.workingCount === 0) return true
    return new Promise<boolean>((resolve) => {
      const done = (): void => { clearTimeout(timer); this.#idleWaiters.delete(done); resolve(true) }
      const timer = setTimeout(() => { this.#idleWaiters.delete(done); resolve(false) }, timeoutMs)
      this.#idleWaiters.add(done)
    })
  }

  interruptOwned(): void { this.#runner.interruptOwned() }

  async steer(key: SessionKey, message: string, images?: readonly RuntimePromptImage[], attachmentMarker?: unknown, agentMentions?: readonly RuntimeAgentMention[]): Promise<boolean> {
    const active = this.#active.get(key.sessionId)
    if (active === undefined) return false
    if (agentMentions !== undefined) await active.turn.steer(message, images, attachmentMarker, agentMentions)
    else if (attachmentMarker !== undefined) await active.turn.steer(message, images, attachmentMarker)
    else if (images !== undefined) await active.turn.steer(message, images)
    else await active.turn.steer(message)
    return true
  }

  async sendAgentMessage(key: SessionKey, message: RuntimeAgentMessage): Promise<boolean> {
    const active = this.#active.get(key.sessionId)
    if (active?.turn.sendAgentMessage === undefined) return false
    await active.turn.sendAgentMessage(message)
    return true
  }

  async followUp(key: SessionKey, message: string, images?: readonly RuntimePromptImage[], attachmentMarker?: unknown, agentMentions?: readonly RuntimeAgentMention[]): Promise<boolean> {
    const active = this.#active.get(key.sessionId)
    if (active === undefined) return false
    if (agentMentions !== undefined) await active.turn.followUp(message, images, attachmentMarker, agentMentions)
    else if (attachmentMarker !== undefined) await active.turn.followUp(message, images, attachmentMarker)
    else if (images !== undefined) await active.turn.followUp(message, images)
    else await active.turn.followUp(message)
    return true
  }

  control(key: SessionKey, sessionPath: string, cwd: string, command: RuntimeControlCommand): Promise<RuntimeResponse> {
    const active = this.#active.get(key.sessionId)
    return active?.turn.control(command) ?? this.#runner.control({ projectId: key.projectId, sessionId: key.sessionId, sessionPath, cwd, command })
  }

  async clearQueue(key: SessionKey): Promise<boolean> {
    const active = this.#active.get(key.sessionId)
    if (active?.turn.clearQueue === undefined) return false
    await active.turn.clearQueue()
    return true
  }

  async abort(key: SessionKey): Promise<boolean> {
    const active = this.#active.get(key.sessionId)
    if (active === undefined) return false
    await active.turn.abort()
    return true
  }

  delegatedStarted(key: SessionKey): void {
    const id = key.sessionId
    if (this.#delegated.has(id)) return
    this.#delegated.add(id)
    this.#attentionIds.set(id, randomUUID())
    this.#publishPhase(key, "working")
  }

  delegatedEvent(key: SessionKey, event: RuntimeEvent): void {
    if (!this.#delegated.has(key.sessionId)) return
    const normalized = normalizeRpcEvent(event)
    if (normalized !== undefined) this.#publish(key, normalized)
    const attention = normalizeAttentionCandidate(event)
    if (attention !== undefined) this.#attentionCandidates.set(key.sessionId, attention)
  }

  async delegatedFinished(input: {
    readonly key: SessionKey
    readonly settledTimeline: () => Promise<readonly TimelineItem[]>
    readonly error?: string
  }): Promise<void> {
    const id = input.key.sessionId
    if (!this.#delegated.has(id)) return
    if (input.error !== undefined) {
      this.#publish(input.key, { version: 2, type: "error", message: input.error })
    }
    try {
      this.#publish(input.key, {
        version: 2,
        type: "timeline",
        timeline: await input.settledTimeline(),
      })
    } catch (error) {
      this.#publish(input.key, {
        version: 2,
        type: "error",
        message: error instanceof Error ? error.message : "Delegated Session Timeline refresh failed",
      })
    } finally {
      this.#delegated.delete(id)
      this.#publishPhase(input.key, "idle")
      this.#notifyIdle()
    }
    const candidate = input.error === undefined
      ? this.#attentionCandidates.get(id) ?? { kind: "needs-attention" as const }
      : { kind: "needs-attention" as const }
    await this.#finishAttention(input.key, id, candidate)
  }

  start(input: StartTurn): boolean {
    return this.startTracked(input).accepted
  }

  startTracked(input: StartTurn): { readonly accepted: boolean; readonly completion?: Promise<void> } {
    const id = input.sessionId
    if (this.#active.has(id)) return { accepted: false }

    this.#attentionIds.set(id, randomUUID())
    const phaseGeneration = this.#publishPhase(input, "working")
    const generation: { active?: ActiveTurn } = {}
    const turn = this.#runner.run({
      projectId: input.projectId,
      sessionId: input.sessionId,
      session: input.mode,
      cwd: input.cwd,
      prompt: input.prompt,
      ...(input.images === undefined ? {} : { images: input.images }),
      ...(input.sessionPath === undefined ? {} : { sessionPath: input.sessionPath }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.attachmentMarker === undefined ? {} : { attachmentMarker: input.attachmentMarker }),
      ...(input.agentMentions === undefined ? {} : { agentMentions: input.agentMentions }),
      ...(input.agentMessage === undefined ? {} : { agentMessage: input.agentMessage }),
      onEvent: (event) => {
        if (generation.active !== undefined && this.#active.get(id) !== generation.active) return
        const normalized = normalizeRpcEvent(event)
        if (normalized !== undefined) this.#publish(input, normalized)
        const attention = normalizeAttentionCandidate(event)
        if (attention !== undefined) this.#attentionCandidates.set(id, attention)
      },
    })

    const active = { turn, key: input, generation: phaseGeneration }
    generation.active = active
    this.#active.set(id, active)
    const completion = this.#finish(id, input, active)
    void completion.catch(() => undefined)
    return { accepted: true, completion }
  }

  async #finish(id: string, input: StartTurn, active: ActiveTurn): Promise<void> {
    let failed = false
    let failure: unknown
    try {
      await Promise.race([active.turn.completion, active.turn.ownershipLost])
      const timeline = await input.settledTimeline()
      if (this.#active.get(id) !== active) return
      this.#publish(input, { version: 2, type: "timeline", timeline })
    } catch (error) {
      if (this.#active.get(id) !== active) return
      failed = true
      failure = error
      this.#publish(input, {
        version: 2,
        type: "error",
        message: error instanceof Error ? error.message : "Turn failed",
      })
    }
    if (this.#active.get(id) !== active) return
    this.#active.delete(id)
    this.#publishPhase(input, "idle")
    for (const listener of this.#sessionIdleListeners) listener(input)
    this.#notifyIdle()
    const candidate = failed
      ? { kind: "needs-attention" as const }
      : this.#attentionCandidates.get(id) ?? { kind: "needs-attention" as const }
    await this.#finishAttention(input, id, candidate)
    if (failure !== undefined) throw failure instanceof Error ? failure : new Error("Turn failed")
  }

  #publishPhase(key: SessionKey, phase: "working" | "idle"): number {
    const id = key.sessionId
    const generation = (this.#phaseGenerations.get(id) ?? 0) + 1
    this.#phaseGenerations.set(id, generation)
    this.#publish(key, { version: 2, type: "phase", phase, epoch: this.#phaseEpoch, generation })
    return generation
  }

  #notifyIdle(): void {
    if (this.workingCount !== 0) return
    for (const done of [...this.#idleWaiters]) done()
  }

  async #finishAttention(key: SessionKey, id: string, candidate: AttentionCandidate): Promise<void> {
    const attentionId = this.#attentionIds.get(id)
    this.#attentionIds.delete(id)
    this.#attentionCandidates.delete(id)
    if (attentionId === undefined) return
    try {
      await this.#publishAttention({ projectId: key.projectId, sessionId: key.sessionId, id: attentionId, ...candidate })
    } catch (error) {
      console.error(JSON.stringify({ event: "pi-station.session-attention-failed", message: error instanceof Error ? error.message : "unknown" }))
    }
  }
}

export function normalizeAttentionCandidate(event: RuntimeEvent): AttentionCandidate | undefined {
  if (event.type !== "turn_end") return undefined
  const message = asRecord((event as unknown as Record<string, unknown>).message)
  if (message?.role !== "assistant") return undefined
  const stopReason = message.stopReason
  if (stopReason === "stop" || stopReason === "length") {
    const content = message.content
    const text = Array.isArray(content)
      ? content.flatMap((part): string[] => {
        const item = asRecord(part)
        return item?.type === "text" && typeof item.text === "string" ? [item.text] : []
      }).join("\n")
      : typeof content === "string" ? content : ""
    return { kind: "completed", ...(text === "" ? {} : { text }) }
  }
  if (stopReason === "aborted" || stopReason === "error") return { kind: "needs-attention" }
  return undefined
}

export function normalizeRpcEvent(event: RuntimeEvent): StreamEvent | undefined {
  const source = event as unknown as Record<string, unknown>
  if (event.type === "message_update") {
    const update = asRecord(source.assistantMessageEvent)
    if (
      (update?.type === "text_delta" || update?.type === "thinking_delta")
      && typeof update.delta === "string"
    ) {
      return {
        version: 2,
        type: update.type === "text_delta" ? "assistant.delta" : "thinking.delta",
        text: update.delta,
      }
    }
  }

  if (
    event.type === "tool_execution_start"
    || event.type === "tool_execution_update"
    || event.type === "tool_execution_end"
  ) {
    const partial = event.type === "tool_execution_start"
      ? undefined
      : event.type === "tool_execution_update" ? source.partialResult : source.result
    return {
      version: 2,
      type: "tool",
      toolCallId: typeof source.toolCallId === "string" ? source.toolCallId : "unknown-tool",
      title: typeof source.toolName === "string" ? source.toolName : "Tool",
      ...(event.type === "tool_execution_start" ? { inputText: displayToolValue(source.args) } : {}),
      ...(partial === undefined ? {} : { outputText: displayToolValue(partial) }),
      state: event.type === "tool_execution_end"
        ? source.isError === true ? "failed" : "succeeded"
        : "running",
    }
  }

  return undefined
}

function displayToolValue(value: unknown): string {
  if (typeof value === "string") return value
  const record = asRecord(value)
  if (record !== undefined && Array.isArray(record.content)) {
    const text = record.content.flatMap((part): string[] => {
      const item = asRecord(part)
      return item !== undefined && item.type === "text" && typeof item.text === "string" ? [item.text] : []
    }).join("\n")
    if (text !== "") return text
  }
  try {
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
