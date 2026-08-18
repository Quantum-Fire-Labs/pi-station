import { describe, expect, it, vi } from "vitest"
import { SessionFileWatcher } from "../session-file-watcher.js"

describe("SessionFileWatcher", () => {
  it("reconciles on subscribe and when an open Session JSONL changes", async () => {
    vi.useFakeTimers()
    let signature = { modifiedMs: 1, size: 10 }
    const inspect = vi.fn(() => Promise.resolve(signature))
    const changed = vi.fn(() => Promise.resolve())
    const watcher = new SessionFileWatcher({ intervalMs: 100, inspect })

    const unsubscribe = watcher.subscribe("/sessions/one.jsonl", changed)
    await Promise.resolve()
    expect(changed).toHaveBeenCalledOnce()

    signature = { modifiedMs: 2, size: 20 }
    await vi.advanceTimersByTimeAsync(100)
    expect(changed).toHaveBeenCalledTimes(2)

    unsubscribe()
    await vi.advanceTimersByTimeAsync(200)
    expect(inspect).toHaveBeenCalledTimes(2)
    watcher.dispose()
    vi.useRealTimers()
  })

  it("does not reconcile unchanged files on each bounded poll", async () => {
    vi.useFakeTimers()
    const changed = vi.fn(() => Promise.resolve())
    const watcher = new SessionFileWatcher({
      intervalMs: 100,
      inspect: () => Promise.resolve({ modifiedMs: 1, size: 10 }),
    })

    watcher.subscribe("/sessions/one.jsonl", changed)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(300)

    expect(changed).toHaveBeenCalledOnce()
    watcher.dispose()
    vi.useRealTimers()
  })
})
