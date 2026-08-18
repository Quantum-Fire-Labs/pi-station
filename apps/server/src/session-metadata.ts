import { join } from "node:path"
import type {
  SavedSession,
  SessionKey,
  SessionState,
} from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

type Metadata = Record<string, { readonly state: SessionState }>
type PersistedSessionState = SessionState | "active" | "archived"
type PersistedMetadata = Record<string, { readonly state: PersistedSessionState }>

export class SessionMetadataStore {
  readonly #store: AtomicJsonStore<PersistedMetadata>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "sessions.json"), isPersistedMetadata)
  }

  async decorate(
    sessions: readonly Omit<SavedSession, "state">[],
  ): Promise<readonly SavedSession[]> {
    const persisted = await this.#store.read({})
    const metadata = normalizeMetadata(needsMigration(persisted)
      ? await this.#store.update({}, normalizeMetadata)
      : persisted)
    return sessions.map((session) => ({
      ...session,
      state: metadata[session.id]?.state ?? "open",
    }))
  }

  async set(key: SessionKey, state: SessionState): Promise<void> {
    await this.#store.update({}, (persisted) => ({
      ...normalizeMetadata(persisted),
      [key.sessionId]: { state },
    }))
  }

  async removeProject(projectId: string): Promise<void> {
    void projectId
    await this.#store.update({}, normalizeMetadata)
  }
}

function normalizeMetadata(metadata: PersistedMetadata): Metadata {
  const normalized: Record<string, { state: SessionState }> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const sessionId = storedSessionId(key)
    const state = value.state === "archived" || value.state === "closed" ? "closed" : "open"
    if (normalized[sessionId]?.state !== "closed") normalized[sessionId] = { state }
  }
  return normalized
}

function storedSessionId(key: string): string {
  const separator = key.indexOf(":")
  return separator < 0 ? key : key.slice(separator + 1)
}

function needsMigration(metadata: PersistedMetadata): boolean {
  return Object.entries(metadata).some(([key, { state }]) => key.includes(":") || state === "active" || state === "archived")
}

function isPersistedMetadata(value: unknown): value is PersistedMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return Object.keys(record).length === 1
      && (record.state === "open" || record.state === "closed" || record.state === "active" || record.state === "archived")
  })
}
