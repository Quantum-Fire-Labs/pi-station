import { join } from "node:path"
import type { SessionKey, SessionUnreadState } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

interface AttentionRecord {
  readonly sessionId: string
  readonly projectId?: string
  readonly latestAttentionId: string
  readonly readAttentionId?: string
  readonly updatedAt: string
}

interface AttentionState {
  readonly version: 1
  readonly records: readonly AttentionRecord[]
}

const EMPTY: AttentionState = { version: 1, records: [] }
const MAX_RECORDS = 2_000

export class SessionAttentionStore {
  readonly #store: AtomicJsonStore<AttentionState>
  readonly #now: () => Date

  constructor(dataDir: string, now = () => new Date()) {
    this.#store = new AtomicJsonStore(join(dataDir, "session-attention.json"), isAttentionState)
    this.#now = now
  }

  async record(key: SessionKey, attentionId: string): Promise<boolean> {
    let changed = false
    await this.#store.update(EMPTY, (stored) => {
      const current = normalizeState(stored)
      const prior = current.records.find((item) => item.sessionId === key.sessionId)
      if (prior?.latestAttentionId === attentionId) return current
      changed = true
      const record: AttentionRecord = {
        sessionId: key.sessionId,
        latestAttentionId: attentionId,
        ...(prior?.readAttentionId === undefined ? {} : { readAttentionId: prior.readAttentionId }),
        updatedAt: this.#now().toISOString(),
      }
      return { version: 1, records: [record, ...current.records.filter((item) => item.sessionId !== key.sessionId)].slice(0, MAX_RECORDS) }
    })
    return changed
  }

  async markRead(key: SessionKey, attentionId: string): Promise<SessionUnreadState | undefined> {
    let result: SessionUnreadState | undefined
    await this.#store.update(EMPTY, (stored) => {
      const current = normalizeState(stored)
      const prior = current.records.find((item) => item.sessionId === key.sessionId)
      if (prior === undefined || prior.latestAttentionId !== attentionId) return current
      result = { hasUnread: false }
      if (prior.readAttentionId === attentionId) return current
      const record = { ...prior, readAttentionId: attentionId, updatedAt: this.#now().toISOString() }
      return { version: 1, records: current.records.map((item) => item === prior ? record : item) }
    })
    return result
  }

  async unread(key: SessionKey): Promise<SessionUnreadState> {
    const current = await this.#normalized()
    return unreadState(current.records.find((item) => item.sessionId === key.sessionId))
  }

  async decorate<T extends { readonly projectId: string; readonly id: string; readonly parentSessionId?: string }>(sessions: readonly T[]): Promise<readonly (T & { readonly unread: SessionUnreadState })[]> {
    const records = await this.#normalized()
    return sessions.map((session) => ({
      ...session,
      unread: unreadState(records.records.find((item) => item.sessionId === session.id)),
    }))
  }

  #normalized(): Promise<AttentionState> {
    return this.#store.update(EMPTY, normalizeState)
  }
}

function normalizeState(state: AttentionState): AttentionState {
  const records = [...state.records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const seen = new Set<string>()
  return { version: 1, records: records.flatMap((stored) => {
    const { projectId, ...record } = stored
    void projectId
    if (seen.has(record.sessionId)) return []
    seen.add(record.sessionId)
    return [record]
  }).slice(0, MAX_RECORDS) }
}

function unreadState(record: AttentionRecord | undefined): SessionUnreadState {
  return record === undefined || record.latestAttentionId === record.readAttentionId
    ? { hasUnread: false }
    : { hasUnread: true, latestAttentionId: record.latestAttentionId }
}

function isAttentionState(value: unknown): value is AttentionState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) return false
  return value.records.every((record) => isRecord(record)
    && exactKeys(record, ["sessionId", "latestAttentionId", "updatedAt"], ["projectId", "readAttentionId"])
    && (record.projectId === undefined || validText(record.projectId, 200))
    && validText(record.sessionId, 200)
    && validText(record.latestAttentionId, 500)
    && (record.readAttentionId === undefined || validText(record.readAttentionId, 500))
    && typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt)))
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
}
