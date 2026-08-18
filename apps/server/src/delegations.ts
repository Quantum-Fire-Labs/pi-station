import { join } from "node:path"
import { AtomicJsonStore } from "./atomic-json-store.js"
import type { RuntimeEvent } from "./session-runtime.js"

export type DelegationStatus = "working" | "completed" | "failed" | "cancelled" | "interrupted"

export interface DelegationRecord {
  readonly id: string
  readonly projectId: string
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly childPath: string
  readonly name?: string
  readonly status: DelegationStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly error?: string
}

function isRecord(value: unknown): value is DelegationRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === "string" && typeof item.projectId === "string"
    && typeof item.parentSessionId === "string" && typeof item.childSessionId === "string"
    && typeof item.childPath === "string" && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string"
    && (item.status === "working" || item.status === "completed" || item.status === "failed" || item.status === "cancelled" || item.status === "interrupted")
    && (item.name === undefined || typeof item.name === "string")
    && (item.error === undefined || typeof item.error === "string")
}

export class DelegationStore {
  readonly #store: AtomicJsonStore<readonly DelegationRecord[]>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "delegations.json"), (value): value is readonly DelegationRecord[] => (
      Array.isArray(value) && value.every(isRecord)
    ))
  }

  list(): Promise<readonly DelegationRecord[]> { return this.#store.read([]) }

  async directChild(input: { projectId: string; parentSessionId: string; childSessionId: string }): Promise<DelegationRecord | undefined> {
    return (await this.list()).find((item) => item.parentSessionId === input.parentSessionId
      && item.childSessionId === input.childSessionId)
  }

  async byChild(): Promise<ReadonlyMap<string, DelegationRecord>> {
    return new Map((await this.list()).map((item) => [item.childSessionId, item]))
  }

  put(record: DelegationRecord): Promise<readonly DelegationRecord[]> {
    return this.#store.update([], (current) => [record, ...current.filter((item) => item.id !== record.id)])
  }

  removeProject(projectId: string): Promise<readonly DelegationRecord[]> {
    return this.#store.update([], (current) => current.filter((item) => item.projectId !== projectId))
  }

  async interruptWorking(): Promise<readonly DelegationRecord[]> {
    const updatedAt = new Date().toISOString()
    const interrupted: DelegationRecord[] = []
    await this.#store.update([], (current) => current.map((item) => {
      if (item.status !== "working") return item
      const record: DelegationRecord = { ...item, status: "interrupted", updatedAt, error: "Pi Station lost ownership of the delegation runtime" }
      interrupted.push(record)
      return record
    }))
    return interrupted
  }
}

export type DelegationEvent =
  | { readonly type: "started"; readonly record: DelegationRecord }
  | { readonly type: "completed"; readonly record: DelegationRecord }
  | { readonly type: "failed"; readonly record: DelegationRecord }
  | { readonly type: "closed"; readonly record: DelegationRecord }

export type DelegatedTurnEvent =
  | { readonly type: "started"; readonly record: DelegationRecord }
  | { readonly type: "runtime-event"; readonly record: DelegationRecord; readonly event: RuntimeEvent }
  | { readonly type: "finished"; readonly record: DelegationRecord; readonly error?: string }

export class DelegationEvents {
  readonly #listeners = new Set<(event: DelegationEvent) => void>()
  readonly #turnListeners = new Set<(event: DelegatedTurnEvent) => void>()

  subscribe(listener: (event: DelegationEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscribeTurns(listener: (event: DelegatedTurnEvent) => void): () => void {
    this.#turnListeners.add(listener)
    return () => this.#turnListeners.delete(listener)
  }

  publish(event: DelegationEvent): void { for (const listener of this.#listeners) listener(event) }
  publishTurn(event: DelegatedTurnEvent): void { for (const listener of this.#turnListeners) listener(event) }
}
