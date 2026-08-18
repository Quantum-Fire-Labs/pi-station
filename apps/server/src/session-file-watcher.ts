import { stat } from "node:fs/promises"

const DEFAULT_INTERVAL_MS = 1_000
const MAX_WATCHED_SESSIONS = 100

interface FileSignature {
  readonly modifiedMs: number
  readonly size: number
}

interface WatchedFile {
  readonly path: string
  readonly listener: () => Promise<void>
  signature?: FileSignature
  checking: boolean
  subscriptions: number
}

export interface SessionFileWatcherOptions {
  readonly intervalMs?: number
  readonly inspect?: (path: string) => Promise<FileSignature | undefined>
}

/** Polls only JSONL files that have an open Session event stream. */
export class SessionFileWatcher {
  readonly #files = new Map<string, WatchedFile>()
  readonly #intervalMs: number
  readonly #inspect: (path: string) => Promise<FileSignature | undefined>
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(options: SessionFileWatcherOptions = {}) {
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.#inspect = options.inspect ?? inspectFile
  }

  subscribe(path: string, listener: () => Promise<void>): () => void {
    let watched = this.#files.get(path)
    if (watched === undefined) {
      if (this.#files.size >= MAX_WATCHED_SESSIONS) return () => undefined
      watched = { path, listener, checking: false, subscriptions: 0 }
      this.#files.set(path, watched)
    }
    watched.subscriptions += 1
    this.#start()
    void this.#check(watched, true)

    return () => {
      const current = this.#files.get(path)
      if (current === undefined) return
      current.subscriptions -= 1
      if (current.subscriptions === 0) this.#files.delete(path)
      if (this.#files.size === 0) this.dispose()
    }
  }

  dispose(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer)
    this.#timer = undefined
    this.#files.clear()
  }

  #start(): void {
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => {
      for (const watched of this.#files.values()) void this.#check(watched, false)
    }, this.#intervalMs)
    this.#timer.unref?.()
  }

  async #check(watched: WatchedFile, reconcile: boolean): Promise<void> {
    if (watched.checking) return
    watched.checking = true
    try {
      const signature = await this.#inspect(watched.path)
      if (signature === undefined) return
      const changed = watched.signature !== undefined
        && (watched.signature.modifiedMs !== signature.modifiedMs || watched.signature.size !== signature.size)
      watched.signature = signature
      if (!reconcile && !changed) return
      await watched.listener()
    } finally {
      watched.checking = false
    }
  }
}

async function inspectFile(path: string): Promise<FileSignature | undefined> {
  try {
    const metadata = await stat(path)
    return { modifiedMs: metadata.mtimeMs, size: metadata.size }
  } catch {
    return undefined
  }
}
