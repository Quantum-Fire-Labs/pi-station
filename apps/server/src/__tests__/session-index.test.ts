import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { Project } from "@pi-station/application-protocol"
import { PersistentSessionIndex } from "../session-index.js"

const project: Project = { id: "project-1", root: "/project-1" }
const oldSession = { id: "session-1", projectId: project.id, path: "/old.jsonl", name: "Old", modifiedAt: "2026-01-01T00:00:00.000Z" }
const newSession = { ...oldSession, path: "/new.jsonl", name: "New", modifiedAt: "2026-01-02T00:00:00.000Z" }

async function dataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-station-index-"))
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Condition was not met")
}

describe("persistent Session index", () => {
  it("waits for revalidation before serving the first index snapshot", async () => {
    const directory = await dataDir()
    await writeFile(join(directory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession] }))
    let release: ((sessions: readonly typeof newSession[]) => void) | undefined
    const scan = vi.fn(() => new Promise<readonly typeof newSession[]>((resolve) => { release = resolve }))
    const index = new PersistentSessionIndex(directory, { scan })

    const listed = index.list([project])
    await waitFor(() => scan.mock.calls.length === 1)
    let settled = false
    void listed.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    release?.([newSession])
    await expect(listed).resolves.toEqual([newSession])
  })

  it("persists the initial refresh for the next process", async () => {
    const directory = await dataDir()
    const first = new PersistentSessionIndex(directory, { scan: () => Promise.resolve([newSession]) })
    await expect(first.list([project])).resolves.toEqual([newSession])

    const second = new PersistentSessionIndex(directory, { scan: () => Promise.resolve([newSession]) })
    await expect(second.get({ projectId: project.id, sessionId: newSession.id })).resolves.toEqual(newSession)
  })

  it("retries the initial refresh after a scan failure", async () => {
    const directory = await dataDir()
    const scan = vi.fn()
      .mockRejectedValueOnce(new Error("Scan failed"))
      .mockResolvedValueOnce([newSession])
    const index = new PersistentSessionIndex(directory, { scan })

    await expect(index.list([project])).rejects.toThrow("Scan failed")
    await expect(index.list([project])).resolves.toEqual([newSession])
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it("uses Session identity for lookup and selects the newest duplicate copy", async () => {
    const directory = await dataDir()
    await writeFile(join(directory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession] }))
    const index = new PersistentSessionIndex(directory, { scan: () => Promise.resolve([]) })

    await expect(index.get({ projectId: "routing-context", sessionId: oldSession.id })).resolves.toEqual(oldSession)

    const duplicateDirectory = await dataDir()
    await writeFile(join(duplicateDirectory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession, newSession] }))
    const duplicateIndex = new PersistentSessionIndex(duplicateDirectory, { scan: () => Promise.resolve([oldSession, newSession]) })
    await expect(duplicateIndex.get({ projectId: project.id, sessionId: oldSession.id })).resolves.toEqual(newSession)
    await expect(duplicateIndex.list([project])).resolves.toEqual([newSession])
  })

  it("indexes a known SDK-created Session without a scanner listing", async () => {
    const directory = await dataDir()
    const scan = vi.fn(() => Promise.resolve<readonly typeof newSession[]>([]))
    const index = new PersistentSessionIndex(directory, { scan })

    await expect(index.indexSession(newSession)).resolves.toEqual(newSession)
    await expect(index.get({ projectId: project.id, sessionId: newSession.id })).resolves.toEqual(newSession)
    expect(scan).not.toHaveBeenCalled()

    const reloaded = new PersistentSessionIndex(directory, { scan })
    await expect(reloaded.get({ projectId: project.id, sessionId: newSession.id })).resolves.toEqual(newSession)
  })

  it("preserves a directly indexed Session across an in-flight stale scan", async () => {
    const directory = await dataDir()
    let release: ((sessions: readonly typeof newSession[]) => void) | undefined
    const scan = vi.fn()
      .mockImplementationOnce(() => new Promise<readonly typeof newSession[]>((resolve) => { release = resolve }))
      .mockResolvedValue([])
    const index = new PersistentSessionIndex(directory, { scan })

    const listed = index.list([project])
    await waitFor(() => scan.mock.calls.length === 1)
    await index.indexSession(newSession)
    release?.([])
    await expect(listed).resolves.toEqual([newSession])

    await expect(index.get({ projectId: project.id, sessionId: newSession.id })).resolves.toEqual(newSession)
    await expect(index.refreshSession({ projectId: project.id, sessionId: newSession.id }, project)).resolves.toEqual(newSession)
  })

  it("does not let a stale in-flight Project scan replace newer targeted metadata", async () => {
    const directory = await dataDir()
    await writeFile(join(directory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession] }))
    let release: ((sessions: readonly typeof oldSession[]) => void) | undefined
    const scan = vi.fn(() => new Promise<readonly typeof oldSession[]>((resolve) => { release = resolve }))
    const refresh = vi.fn(() => Promise.resolve(newSession))
    const index = new PersistentSessionIndex(directory, { scan, refresh })

    const listed = index.list([project])
    await waitFor(() => scan.mock.calls.length === 1)
    await expect(index.refreshSession({ projectId: project.id, sessionId: oldSession.id }, project)).resolves.toEqual(newSession)
    release?.([oldSession])
    await expect(listed).resolves.toEqual([newSession])

    await expect(index.get({ projectId: project.id, sessionId: oldSession.id })).resolves.toEqual(newSession)
  })

  it("persists a renamed Session immediately", async () => {
    const directory = await dataDir()
    await writeFile(join(directory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession] }))
    const index = new PersistentSessionIndex(directory, { scan: () => Promise.resolve([]) })

    await expect(index.rename({ projectId: project.id, sessionId: oldSession.id }, "Renamed")).resolves.toEqual({ ...oldSession, name: "Renamed" })
    const reloaded = new PersistentSessionIndex(directory, { scan: () => new Promise(() => undefined) })
    await expect(reloaded.get({ projectId: project.id, sessionId: oldSession.id })).resolves.toEqual({ ...oldSession, name: "Renamed" })
  })

  it("uses an authoritative targeted refresh instead of the cached Project scan", async () => {
    const directory = await dataDir()
    await writeFile(join(directory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession] }))
    const scan = vi.fn(() => Promise.resolve([oldSession]))
    const refresh = vi.fn(() => Promise.resolve(newSession))
    const index = new PersistentSessionIndex(directory, { scan, refresh })

    await expect(index.refreshSession({ projectId: project.id, sessionId: oldSession.id }, project)).resolves.toEqual(newSession)
    expect(refresh).toHaveBeenCalledWith(project, { projectId: project.id, sessionId: oldSession.id }, oldSession)
    expect(scan).not.toHaveBeenCalled()
  })

  it("refreshes only the requested Session entry after settlement", async () => {
    const directory = await dataDir()
    const unchanged = { id: "session-2", projectId: project.id, path: "/unchanged.jsonl", modifiedAt: "2026-01-01T00:00:00.000Z" }
    await writeFile(join(directory, "session-index.json"), JSON.stringify({ version: 1, sessions: [oldSession, unchanged] }))
    const index = new PersistentSessionIndex(directory, { scan: () => Promise.resolve([newSession, { ...unchanged, name: "Scanner value" }]) })

    await expect(index.refreshSession({ projectId: project.id, sessionId: oldSession.id }, project)).resolves.toEqual(newSession)
    await expect(index.get({ projectId: project.id, sessionId: unchanged.id })).resolves.toEqual(unchanged)
  })
})
