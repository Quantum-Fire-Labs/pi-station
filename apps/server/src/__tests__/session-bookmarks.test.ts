import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { SavedSession } from "@pi-station/application-protocol"
import { SessionBookmarkStore } from "../session-bookmarks.js"

const sessions: SavedSession[] = [
  { id: "one", projectId: "p1", path: "/p1", modifiedAt: "2026-01-01T00:00:00Z", state: "open" },
  { id: "two", projectId: "p1", path: "/p1", modifiedAt: "2026-01-02T00:00:00Z", state: "closed" },
  { id: "three", projectId: "p2", path: "/p2", modifiedAt: "2026-01-03T00:00:00Z", state: "open" },
]

describe("Session Bookmark store", () => {
  it("persists Session IDs and derives each current Project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rpc-session-bookmarks-"))
    const path = join(directory, "session-bookmarks.json")
    await writeFile(path, JSON.stringify([{ projectId: "old-project", sessionId: "one" }]))
    const store = new SessionBookmarkStore(directory)
    await store.set("p2", "three", true, sessions)
    await store.set("p1", "two", true, sessions)
    await store.reorder("p1", "two", "up", sessions)
    expect(await store.list(sessions)).toEqual([
      { projectId: "p1", sessionKey: { hostId: "p1", piSessionId: "two" }, position: 0 },
      { projectId: "p2", sessionKey: { hostId: "p2", piSessionId: "three" }, position: 0 },
      { projectId: "p1", sessionKey: { hostId: "p1", piSessionId: "one" }, position: 1 },
    ])
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
      { sessionId: "two" }, { sessionId: "three" }, { sessionId: "one" },
    ])
    await store.removeProject("p1")
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
      { sessionId: "two" }, { sessionId: "three" }, { sessionId: "one" },
    ])
  })
})
