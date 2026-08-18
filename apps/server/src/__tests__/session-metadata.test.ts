import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SessionMetadataStore } from "../session-metadata.js"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe("SessionMetadataStore", () => {
  it("defaults indexed Sessions to open and persists close and open", async () => {
    const directory = await makeDirectory()
    const store = new SessionMetadataStore(directory)
    const indexed = [{ id: "s1", projectId: "p1", path: "/session.jsonl", modifiedAt: "2026-01-01T00:00:00Z" }]

    expect((await store.decorate(indexed))[0]?.state).toBe("open")
    await store.set({ projectId: "p1", sessionId: "s1" }, "closed")
    expect((await store.decorate(indexed))[0]?.state).toBe("closed")
    expect((await store.decorate([{ ...indexed[0]!, projectId: "p2" }]))[0]?.state).toBe("closed")
    await store.set({ projectId: "p1", sessionId: "s1" }, "open")
    expect((await store.decorate(indexed))[0]?.state).toBe("open")
  })

  it("reads old lifecycle metadata and migrates all records to open and closed", async () => {
    const directory = await makeDirectory()
    const path = join(directory, "sessions.json")
    await writeFile(path, JSON.stringify({
      "p1:open": { state: "active" },
      "p1:closed": { state: "archived" },
    }))
    const store = new SessionMetadataStore(directory)
    const indexed = [
      { id: "open", projectId: "p1", path: "/open.jsonl", modifiedAt: "2026-01-01T00:00:00Z" },
      { id: "closed", projectId: "p1", path: "/closed.jsonl", modifiedAt: "2026-01-01T00:00:00Z" },
    ]

    expect((await store.decorate(indexed)).map(({ state }) => state)).toEqual(["open", "closed"])
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      open: { state: "open" },
      closed: { state: "closed" },
    })
  })
})

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-station-metadata-"))
  directories.push(directory)
  return directory
}
