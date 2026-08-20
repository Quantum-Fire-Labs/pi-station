import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { QuickSessionStore } from "../quick-session.js"

const roots: string[] = []
afterEach(async () => { const { rm } = await import("node:fs/promises"); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function store(): Promise<{ root: string; value: QuickSessionStore }> { const root = await mkdtemp(join(tmpdir(), "pi-quick-")); roots.push(root); return { root, value: new QuickSessionStore(root) } }

describe("QuickSessionStore", () => {
  it("creates one durable singleton under the Pi Station data directory", async () => {
    const { root, value } = await store()
    const [first, second] = await Promise.all([value.open(), value.open()])
    expect(second.sessionId).toBe(first.sessionId)
    await expect(new QuickSessionStore(root).read()).resolves.toEqual(first)
    expect((await value.saved(first))?.quickSession).toBe(true)
  })

  it("clears managed files and creates a new Session ID", async () => {
    const { value } = await store(); const old = await value.open()
    await writeFile(join(value.workDirectory(old.sessionId), "scratch.txt"), "work")
    const fresh = await value.clear(old.sessionId)
    expect(fresh.sessionId).not.toBe(old.sessionId)
    await expect(readFile(join(value.workDirectory(old.sessionId), "scratch.txt"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps history and copies work without replacing destination files", async () => {
    const { root, value } = await store(); const current = await value.open(); const destination = join(root, "destination")
    await mkdir(destination); await writeFile(join(value.workDirectory(current.sessionId), "notes.txt"), "notes")
    const kept = await value.keep(current.sessionId, destination)
    expect(await readFile(join(destination, "notes.txt"), "utf8")).toBe("notes")
    expect(kept.record.sessionId).toBe(current.sessionId)
    await expect(value.read()).resolves.toBeUndefined()
  })

  it("fails Keep on a work-file conflict and retains the Quick Session", async () => {
    const { root, value } = await store(); const current = await value.open(); const destination = join(root, "destination")
    await mkdir(destination); await writeFile(join(value.workDirectory(current.sessionId), "notes.txt"), "new"); await writeFile(join(destination, "notes.txt"), "old")
    await expect(value.keep(current.sessionId, destination)).rejects.toThrow()
    await expect(value.read()).resolves.toEqual(current)
    expect(await readFile(join(destination, "notes.txt"), "utf8")).toBe("old")
  })
})
