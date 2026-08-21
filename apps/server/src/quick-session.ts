import { randomUUID } from "node:crypto"
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import type { Project, SavedSession } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"
import { projectId } from "./domain.js"

export const QUICK_SESSION_PROJECT_ID = "quick-session"
export interface QuickSessionRecord { readonly version: 1; readonly sessionId: string; readonly sessionPath: string }
const EMPTY: QuickSessionRecord = { version: 1, sessionId: "", sessionPath: "" }
function isRecord(value: unknown): value is QuickSessionRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 3 && record.version === 1 && typeof record.sessionId === "string" && typeof record.sessionPath === "string"
}

/** Owns the durable singleton identity and all managed Quick Session files. */
export class QuickSessionStore {
  readonly #root: string
  readonly #state: AtomicJsonStore<QuickSessionRecord>
  readonly #retainedSessionDirectory: string | undefined
  #operation: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string, retainedSessionDirectory: string | undefined) {
    this.#root = resolve(dataDir, "quick-sessions")
    this.#state = new AtomicJsonStore(join(dataDir, "quick-session.json"), isRecord)
    this.#retainedSessionDirectory = retainedSessionDirectory === undefined ? undefined : resolve(retainedSessionDirectory)
  }
  project(record: QuickSessionRecord): Project { return { id: QUICK_SESSION_PROJECT_ID, root: this.workDirectory(record.sessionId) } }
  workDirectory(id: string): string { return join(this.#root, id, "work") }
  historyDirectory(id: string): string { return join(this.#root, id, "history") }
  async read(): Promise<QuickSessionRecord | undefined> { const record = await this.#state.read(EMPTY); return record.sessionId === "" ? undefined : record }

  open(): Promise<QuickSessionRecord> { return this.#exclusive(async () => (await this.read()) ?? await this.#create()) }
  clear(expectedId: string): Promise<QuickSessionRecord> {
    return this.#exclusive(async () => {
      const current = await this.read()
      if (current?.sessionId !== expectedId) return current ?? await this.#create()
      await rm(join(this.#root, expectedId), { recursive: true, force: true })
      return await this.#create()
    })
  }

  keep(expectedId: string, destination: string): Promise<{ readonly record: QuickSessionRecord; readonly project: Project; readonly sessionPath: string }> {
    return this.#exclusive(async () => {
      const current = await this.read()
      if (current?.sessionId !== expectedId) throw new Error("Quick Session changed before it could be kept")
      const target = resolve(destination)
      if (!(await stat(target)).isDirectory()) throw new Error("Destination is not a directory")
      for (const entry of await readdir(this.workDirectory(expectedId))) await cp(join(this.workDirectory(expectedId), entry), join(target, entry), { recursive: true, errorOnExist: true, force: false })
      const retained = SessionManager.forkFrom(current.sessionPath, target, this.#retainedSessionDirectory, { id: expectedId })
      const sessionPath = retained.getSessionFile()
      if (sessionPath === undefined) throw new Error("Retained Session history was not written")
      await this.#state.replace(EMPTY)
      await rm(join(this.#root, expectedId), { recursive: true, force: true })
      return { record: current, project: { id: projectId(target), root: target }, sessionPath }
    })
  }

  async saved(record: QuickSessionRecord): Promise<SavedSession | undefined> {
    try {
      const metadata = await stat(record.sessionPath)
      return { id: record.sessionId, projectId: QUICK_SESSION_PROJECT_ID, path: record.sessionPath, cwd: this.workDirectory(record.sessionId), modifiedAt: metadata.mtime.toISOString(), state: "open", quickSession: true }
    } catch { return undefined }
  }

  async #create(): Promise<QuickSessionRecord> {
    const sessionId = randomUUID()
    await mkdir(this.workDirectory(sessionId), { recursive: true }); await mkdir(this.historyDirectory(sessionId), { recursive: true })
    const manager = SessionManager.create(this.workDirectory(sessionId), this.historyDirectory(sessionId), { id: sessionId })
    manager.appendMessage({ role: "assistant", content: [], api: "pi-station", provider: "pi-station", model: "quick-session", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() })
    manager.appendCustomEntry("pi-station-quick-session")
    const sessionPath = manager.getSessionFile()
    if (sessionPath === undefined) throw new Error("Quick Session history was not written")
    const record = { version: 1 as const, sessionId, sessionPath }
    await this.#state.replace(record)
    return record
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> { const result = this.#operation.then(operation, operation); this.#operation = result.then(() => undefined, () => undefined); return result }
}
