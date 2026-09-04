import { randomUUID } from "node:crypto"
import type { InlineExtension } from "@earendil-works/pi-coding-agent"
import type { SessionKey } from "@pi-station/application-protocol"

interface ApprovalBase {
  readonly id: string
  readonly projectId: string
  readonly sessionId: string
}

export type CommandApproval = ApprovalBase & (
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "delegation"; readonly model: string; readonly thinkingLevel: string }
)

export type CommandApprovalEvent =
  | { readonly type: "requested"; readonly approval: CommandApproval }
  | { readonly type: "resolved"; readonly approval: CommandApproval }

interface PendingApproval {
  readonly approval: CommandApproval
  readonly resolve: (allowed: boolean) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

const RECURSIVE_RM = /(?:^|[;&|\n]\s*)(?:sudo\s+)?rm\s+(?=[^;&|\n]*(?:--recursive(?:[=\s]|$)|-[A-Za-z]*[rR][A-Za-z]*(?:\s|$)))/u

export function requiresRecursiveRmApproval(command: string): boolean {
  return RECURSIVE_RM.test(command)
}

export class CommandApprovalService {
  readonly #pending = new Map<string, PendingApproval>()
  readonly #listeners = new Set<(event: CommandApprovalEvent) => void>()

  constructor(private readonly timeoutMs = 60_000) {}

  extension(key: SessionKey): InlineExtension {
    return {
      name: "recursive-rm-guard",
      factory: (pi) => {
        pi.on("tool_call", async (event, ctx) => {
          if (event.toolName !== "bash") return
          const command = (event.input as { command?: unknown }).command
          if (typeof command !== "string" || !requiresRecursiveRmApproval(command)) return
          if (!await this.request(key, command, ctx.signal)) return { block: true, reason: "Recursive rm command cancelled by user" }
        })
      },
    }
  }

  request(key: SessionKey, command: string, signal?: AbortSignal): Promise<boolean> {
    return this.#request({ id: randomUUID(), ...key, kind: "command", command }, signal)
  }

  requestDelegation(key: SessionKey, model: string, thinkingLevel: string, signal?: AbortSignal): Promise<boolean> {
    return this.#request({ id: randomUUID(), ...key, kind: "delegation", model, thinkingLevel }, signal)
  }

  #request(approval: CommandApproval, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const abort = (): void => finish(false)
      const cleanup = (): void => signal?.removeEventListener("abort", abort)
      const finish = (allowed: boolean): void => {
        const pending = this.#pending.get(approval.id)
        if (pending === undefined) return
        clearTimeout(pending.timeout)
        cleanup()
        this.#pending.delete(approval.id)
        resolve(allowed)
        this.#publish({ type: "resolved", approval })
      }
      signal?.addEventListener("abort", abort, { once: true })
      const timeout = setTimeout(() => finish(false), this.timeoutMs)
      this.#pending.set(approval.id, { approval, resolve: finish, timeout })
      this.#publish({ type: "requested", approval })
    })
  }

  current(key: SessionKey): CommandApproval | undefined {
    return [...this.#pending.values()]
      .find(({ approval }) => approval.projectId === key.projectId && approval.sessionId === key.sessionId)
      ?.approval
  }

  resolve(key: SessionKey, id: string, allowed: boolean): boolean {
    const pending = this.#pending.get(id)
    if (pending === undefined || pending.approval.projectId !== key.projectId || pending.approval.sessionId !== key.sessionId) return false
    pending.resolve(allowed)
    return true
  }

  subscribe(listener: (event: CommandApprovalEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    for (const pending of [...this.#pending.values()]) pending.resolve(false)
  }

  #publish(event: CommandApprovalEvent): void {
    for (const listener of this.#listeners) listener(event)
  }
}
