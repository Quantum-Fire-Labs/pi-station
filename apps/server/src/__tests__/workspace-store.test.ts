import { mkdtemp, readFile, writeFile } from "node:fs/promises"
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

  it("migrates shared v2 membership with the last Workspace as owner", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const workspace = (id: string, lastSession?: { projectId: string; sessionId: string }) => ({ id, name: id, projectIds: ["project-1"], closedProjectIds: ["project-1"], bookmarkedProjectIds: ["project-1"], ...(lastSession === undefined ? {} : { lastSession }) })
    await writeFile(join(data, "workspaces.json"), JSON.stringify({ version: 2, workspaces: [workspace("one", { projectId: "project-1", sessionId: "old-session" }), workspace("two")], activeWorkspaceId: "one" }))

    const state = await new WorkspaceStore(data).list(projects)

    expect(state.workspaces.map(({ projectIds }) => projectIds)).toEqual([[], ["project-1"]])
    expect(state.workspaces[0]?.lastSession).toBeUndefined()
    expect(state.workspaces[0]?.closedProjectIds).toEqual([])
    expect(state.workspaces[0]?.bookmarkedProjectIds).toEqual([])
    expect(state.activeWorkspaceId).toBe("one")
    expect((JSON.parse(await readFile(join(data, "workspaces.json"), "utf8")) as { version: number }).version).toBe(3)
  })

  it("moves ownership and removes a Project without changing another Workspace", async () => {
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
    const remembered = await store.setLastSession(target, { projectId: "project-1", sessionId: "session-1" }, projects)
    expect(remembered.workspaces[1]?.lastSession).toEqual({ projectId: "project-1", sessionId: "session-1" })
    expect((await new WorkspaceStore(data).list(projects)).workspaces[1]?.lastSession).toEqual({ projectId: "project-1", sessionId: "session-1" })
    await store.openProject(initial.workspaces[0]!.id, "project-1", projects)
    const movedBack = await store.openProject(target, "project-1", projects)
    expect(movedBack.workspaces[0]).toMatchObject({ projectIds: ["project-2"], closedProjectIds: [], bookmarkedProjectIds: [] })
    const removed = await store.removeWorkspaceProject(target, "project-1", projects)
    expect(removed.workspaces[0]).toMatchObject({ projectIds: ["project-2"], closedProjectIds: [] })
    expect(removed.workspaces[1]).toMatchObject({ projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] })
    expect(removed.workspaces[1]?.lastSession).toBeUndefined()
    expect((await store.list(projects)).workspaces[1]?.projectIds).toEqual([])
    await expect(store.ensureOpen("project-1", projects)).resolves.toBeDefined()
    await expect(store.remove(initial.workspaces[0]!.id, projects)).rejects.toBeInstanceOf(WorkspaceStoreError)
  })

  it("opens a Project in only the active Workspace", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const store = new WorkspaceStore(data)
    const initial = await store.list(projects, ["project-1"])
    const first = initial.workspaces[0]!.id
    const created = await store.create({ name: "Other" }, projects)
    const second = created.workspaces[1]!.id
    await store.openProject(second, "project-1", projects)
    await store.select(second, projects)
    await store.setClosed("project-1", true, projects)
    await store.select(first, projects)
    const opened = await store.ensureOpen("project-1", projects)

    expect(opened.workspaces.find(({ id }) => id === first)?.closedProjectIds).toEqual([])
    expect(opened.workspaces.find(({ id }) => id === second)?.closedProjectIds).toEqual(["project-1"])
  })
})
