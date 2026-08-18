import { join } from "node:path"
import type { SavedSession } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

interface StoredSessionBookmark {
  readonly sessionId: string
  readonly projectId?: string
}

export interface SessionBookmark {
  readonly projectId: string
  readonly sessionKey: { readonly hostId: string; readonly piSessionId: string }
  readonly position: number
}

export class SessionBookmarkStore {
  readonly #store: AtomicJsonStore<readonly StoredSessionBookmark[]>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "session-bookmarks.json"), isStoredBookmarks)
  }

  async list(sessions: readonly SavedSession[]): Promise<readonly SessionBookmark[]> {
    const items = await this.#normalized()
    const indexed = new Map(sessions.map((session) => [session.id, session]))
    const positions = new Map<string, number>()
    return items.flatMap((bookmark) => {
      const session = indexed.get(bookmark.sessionId)
      if (session === undefined) return []
      const position = positions.get(session.projectId) ?? 0
      positions.set(session.projectId, position + 1)
      return [{ projectId: session.projectId, sessionKey: { hostId: session.projectId, piSessionId: session.id }, position }]
    })
  }

  async set(_projectId: string, sessionId: string, bookmarked: boolean, sessions: readonly SavedSession[]): Promise<readonly SessionBookmark[]> {
    if (!sessions.some((session) => session.id === sessionId)) throw new Error("Session is not indexed")
    await this.#store.update([], (stored) => {
      const items = normalizeBookmarks(stored)
      return bookmarked
        ? items.some((item) => item.sessionId === sessionId) ? items : [...items, { sessionId }]
        : items.filter((item) => item.sessionId !== sessionId)
    })
    return this.list(sessions)
  }

  async removeProject(projectId: string): Promise<void> {
    void projectId
    await this.#normalized()
  }

  async reorder(projectId: string, sessionId: string, direction: "up" | "down", sessions: readonly SavedSession[]): Promise<readonly SessionBookmark[]> {
    const projects = new Map(sessions.map((session) => [session.id, session.projectId]))
    await this.#store.update([], (stored) => {
      const items = normalizeBookmarks(stored)
      const projectIndexes = items.flatMap((item, index) => projects.get(item.sessionId) === projectId ? [index] : [])
      const offset = projectIndexes.findIndex((index) => items[index]?.sessionId === sessionId)
      const targetOffset = direction === "up" ? offset - 1 : offset + 1
      if (offset < 0 || targetOffset < 0 || targetOffset >= projectIndexes.length) return items
      const next = [...items]
      const index = projectIndexes[offset]!
      const target = projectIndexes[targetOffset]!
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
    return this.list(sessions)
  }

  async #normalized(): Promise<readonly StoredSessionBookmark[]> {
    return this.#store.update([], normalizeBookmarks)
  }
}

function normalizeBookmarks(items: readonly StoredSessionBookmark[]): readonly StoredSessionBookmark[] {
  const seen = new Set<string>()
  return items.flatMap(({ sessionId }) => {
    if (seen.has(sessionId)) return []
    seen.add(sessionId)
    return [{ sessionId }]
  })
}

function isStoredBookmarks(value: unknown): value is readonly StoredSessionBookmark[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    const keys = Object.keys(record)
    return typeof record.sessionId === "string"
      && keys.every((key) => key === "sessionId" || key === "projectId")
      && (record.projectId === undefined || typeof record.projectId === "string")
  })
}
