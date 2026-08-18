import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Project } from "@pi-station/application-protocol"
import { ProjectBookmarkStore } from "../project-bookmarks.js"

const projects: Project[] = [{ id: "one", root: "/one" }, { id: "two", root: "/two" }]

describe("Project Bookmark store", () => {
  it("persists set, ordering, and removal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rpc-bookmarks-"))
    const store = new ProjectBookmarkStore(directory)
    await store.set("one", true, projects)
    await store.set("two", true, projects)
    expect(await store.list(projects)).toEqual([{ projectId: "one", position: 0 }, { projectId: "two", position: 1 }])
    await store.reorder("two", "up", projects)
    expect(await new ProjectBookmarkStore(directory).list(projects)).toEqual([{ projectId: "two", position: 0 }, { projectId: "one", position: 1 }])
    await store.set("two", false, projects)
    expect(await store.list(projects)).toEqual([{ projectId: "one", position: 0 }])
  })
})
