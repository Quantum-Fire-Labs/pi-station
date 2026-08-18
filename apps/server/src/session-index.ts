import { join } from "node:path"
import type { Project, SessionKey } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"
import type { IndexedSession } from "./domain.js"

const INDEX_VERSION = 1

interface StoredSessionIndex {
  readonly version: typeof INDEX_VERSION
  readonly sessions: readonly IndexedSession[]
}

export interface SessionScanner {
  scan(project: Project): Promise<readonly IndexedSession[]>
  scanAll?(projects: readonly Project[]): Promise<readonly IndexedSession[]>
  refresh?(project: Project, key: SessionKey, current: IndexedSession | undefined): Promise<IndexedSession | undefined>
}

export class PersistentSessionIndex {
  readonly #store: AtomicJsonStore<StoredSessionIndex>
  readonly #scanner: SessionScanner
  readonly #sessions = new Map<string, IndexedSession>()
  readonly #directlyIndexed = new Set<string>()
  #loaded: Promise<void> | undefined
  #refresh: Promise<void> | undefined
  #configuredProjects = ""

  constructor(dataDir: string, scanner: SessionScanner) {
    this.#store = new AtomicJsonStore(join(dataDir, "session-index.json"), isStoredSessionIndex)
    this.#scanner = scanner
  }

  async list(projects: readonly Project[]): Promise<readonly IndexedSession[]> {
    await this.#load()
    const configured = new Set(projects.map((project) => project.id))
    const fingerprint = JSON.stringify(projects.map(({ id, root }) => ({ id, root })))
    if (fingerprint !== this.#configuredProjects) {
      if (this.#scanner.scanAll === undefined) this.#removeUnconfigured(configured)
      await this.refresh(projects)
      this.#configuredProjects = fingerprint
    }
    return this.#sorted(this.#scanner.scanAll === undefined ? configured : undefined)
  }

  async get(key: SessionKey, projects?: readonly Project[]): Promise<IndexedSession | undefined> {
    if (projects === undefined) await this.#load()
    else await this.list(projects)
    return this.#sessions.get(key.sessionId)
  }

  refresh(projects: readonly Project[]): Promise<void> {
    if (this.#refresh !== undefined) return this.#refresh
    const operation = this.#refreshAll(projects)
    const tracked = operation.finally(() => {
      if (this.#refresh === tracked) this.#refresh = undefined
    })
    this.#refresh = tracked
    return tracked
  }

  async indexSession(session: IndexedSession): Promise<IndexedSession> {
    await this.#load()
    const key = indexedSessionKey(session)
    this.#sessions.set(key, session)
    this.#directlyIndexed.add(key)
    await this.#persist()
    return session
  }

  async rename(key: SessionKey, name: string): Promise<IndexedSession | undefined> {
    await this.#load()
    const compoundKey = key.sessionId
    const current = this.#sessions.get(compoundKey)
    if (current === undefined) return undefined
    const changed = { ...current, name }
    this.#sessions.set(compoundKey, changed)
    this.#directlyIndexed.add(compoundKey)
    await this.#persist()
    return changed
  }

  async refreshSession(key: SessionKey, project: Project): Promise<IndexedSession | undefined> {
    await this.#load()
    const compoundKey = key.sessionId
    const current = this.#sessions.get(compoundKey)
    const changed = this.#scanner.refresh === undefined
      ? (await this.#scanner.scan(project)).find((session) => session.id === key.sessionId)
      : await this.#scanner.refresh(project, key, current)
    if (changed === undefined) return this.#directlyIndexed.has(compoundKey)
      ? this.#sessions.get(compoundKey)
      : undefined
    this.#sessions.set(compoundKey, changed)
    this.#directlyIndexed.delete(compoundKey)
    await this.#persist()
    return changed
  }

  async #load(): Promise<void> {
    this.#loaded ??= this.#store.read({ version: INDEX_VERSION, sessions: [] }).then((stored) => {
      for (const session of newestSessionsById(stored.sessions)) this.#sessions.set(indexedSessionKey(session), session)
    })
    return this.#loaded
  }

  async #refreshAll(projects: readonly Project[]): Promise<void> {
    await this.#load()
    const scanned = newestSessionsById(this.#scanner.scanAll === undefined
      ? (await Promise.all(projects.map((project) => this.#scanner.scan(project)))).flat()
      : await this.#scanner.scanAll(projects))
    const scannedKeys = new Set(scanned.map(indexedSessionKey))
    const reconciled = scanned.map((session) => {
      const current = this.#sessions.get(indexedSessionKey(session))
      return current !== undefined && current.modifiedAt > session.modifiedAt ? current : session
    })
    const preserved = [...this.#directlyIndexed]
      .filter((key) => !scannedKeys.has(key))
      .flatMap((key) => {
        const session = this.#sessions.get(key)
        return session === undefined ? [] : [session]
      })
    this.#sessions.clear()
    for (const session of [...reconciled, ...preserved]) this.#sessions.set(indexedSessionKey(session), session)
    for (const key of scannedKeys) this.#directlyIndexed.delete(key)
    await this.#persist()
  }

  #removeUnconfigured(configured: ReadonlySet<string>): void {
    for (const [key, session] of this.#sessions) {
      if (!configured.has(session.projectId)) this.#sessions.delete(key)
    }
  }

  #sorted(configured?: ReadonlySet<string>): readonly IndexedSession[] {
    return [...this.#sessions.values()]
      .filter((session) => configured === undefined || configured.has(session.projectId))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  #persist(): Promise<StoredSessionIndex> {
    return this.#store.replace({ version: INDEX_VERSION, sessions: this.#sorted() })
  }
}

function indexedSessionKey(session: IndexedSession): string {
  return session.id
}

function newestSessionsById(sessions: readonly IndexedSession[]): readonly IndexedSession[] {
  const selected = new Map<string, IndexedSession>()
  for (const session of sessions) {
    const current = selected.get(session.id)
    if (current === undefined
      || session.modifiedAt > current.modifiedAt
      || (session.modifiedAt === current.modifiedAt && session.path > current.path)) {
      selected.set(session.id, session)
    }
  }
  return [...selected.values()]
}

function isStoredSessionIndex(value: unknown): value is StoredSessionIndex {
  if (!isRecord(value) || value.version !== INDEX_VERSION || !Array.isArray(value.sessions)) return false
  return value.sessions.every(isIndexedSession)
}

function isIndexedSession(value: unknown): value is IndexedSession {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string" || typeof value.projectId !== "string") return false
  if (typeof value.path !== "string" || typeof value.modifiedAt !== "string") return false
  return value.name === undefined || typeof value.name === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
