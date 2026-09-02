import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { WorkspaceStore, WorkspaceStoreError } from "../workspace-store.js"

const projects = [{ id: "project-1", root: "/one", closed: true }, { id: "project-2", root: "/two" }]

describe("WorkspaceStore", () => {
  it("migrates existing Projects into one default Workspace", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const state = await new WorkspaceStore(data).list(projects, ["project-1", "project-2"])
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]).toMatchObject({ name: "Default", projectIds: ["project-1", "project-2"], closedProjectIds: ["project-1"], bookmarkedProjectIds: ["project-1", "project-2"] })
    expect(state.activeWorkspaceId).toBe(state.workspaces[0]!.id)
  })

  it("preserves shared membership while it migrates ownership data", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    await writeFile(join(data, "workspaces.json"), JSON.stringify({ version: 1, workspaces: [{ id: "one", name: "One", projectIds: ["project-1"] }, { id: "two", name: "Two", projectIds: ["project-1"] }], activeWorkspaceId: "two" }))
    const state = await new WorkspaceStore(data).list(projects)
    expect(state.workspaces.map(({ projectIds }) => projectIds)).toEqual([["project-1"], ["project-1"]])
    expect(state.activeWorkspaceId).toBe("two")
  })

  it("adds and removes membership without changing another Workspace", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const store = new WorkspaceStore(data)
    const initial = await store.list(projects)
    const created = await store.create({ name: "Other" }, projects)
    const target = created.workspaces[1]!.id
    const opened = await store.openProject(target, "project-1", projects)
    expect(opened.workspaces.map(({ projectIds }) => projectIds)).toEqual([["project-2"], ["project-1"]])
    await store.select(target, projects)
    await store.setBookmarked("project-1", true, projects)
    await store.setClosed("project-1", true, projects)
    const removed = await store.removeWorkspaceProject(target, "project-1", projects)
    expect(removed.workspaces[0]).toMatchObject({ projectIds: ["project-2"], closedProjectIds: [] })
    expect(removed.workspaces[1]).toMatchObject({ projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] })
    expect((await store.list(projects)).workspaces[1]?.projectIds).toEqual([])
    await expect(store.ensureOpen("project-1", projects)).resolves.toBeDefined()
    await expect(store.remove(initial.workspaces[0]!.id, projects)).rejects.toBeInstanceOf(WorkspaceStoreError)
  })
})
