import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { WorkspaceStore, WorkspaceStoreError } from "../workspace-store.js"

const projects = [{ id: "project-1", root: "/one", closed: true }, { id: "project-2", root: "/two" }]

describe("WorkspaceStore", () => {
  it("migrates existing Projects into one default Workspace", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const state = await new WorkspaceStore(data).list(projects, ["project-2"])
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]).toMatchObject({ name: "Default", projectIds: ["project-1", "project-2"], closedProjectIds: ["project-1"], bookmarkedProjectIds: ["project-2"] })
    expect(state.activeWorkspaceId).toBe(state.workspaces[0]!.id)
  })

  it("migrates legacy Workspace membership and removes duplicates safely", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    await writeFile(join(data, "workspaces.json"), JSON.stringify({ version: 1, workspaces: [{ id: "one", name: "One", projectIds: ["project-1"] }, { id: "two", name: "Two", projectIds: ["project-1"] }], activeWorkspaceId: "two" }))
    const state = await new WorkspaceStore(data).list(projects)
    expect(state.workspaces.map(({ projectIds }) => projectIds)).toEqual([["project-1", "project-2"], []])
    expect(state.activeWorkspaceId).toBe("two")
  })

  it("moves a Project only through the explicit move operation", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const store = new WorkspaceStore(data)
    const initial = await store.list(projects)
    const created = await store.create({ name: "Other" }, projects)
    const target = created.workspaces[1]!.id
    await store.setBookmarked("project-1", true, projects)
    await store.setClosed("project-1", true, projects)
    const moved = await store.moveProject("project-1", target, projects)
    expect(moved.workspaces.map(({ projectIds }) => projectIds)).toEqual([["project-2"], ["project-1"]])
    expect(moved.workspaces[1]).toMatchObject({ closedProjectIds: ["project-1"], bookmarkedProjectIds: ["project-1"] })
    await expect(store.remove(initial.workspaces[0]!.id, projects)).rejects.toBeInstanceOf(WorkspaceStoreError)
  })
})
