import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { WorkspaceStore } from "../workspace-store.js"

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
    const removed = await store.removeWorkspaceProject(target, "project-1", projects)
    expect(removed.workspaces[0]).toMatchObject({ projectIds: ["project-2"], closedProjectIds: [] })
    expect(removed.workspaces[1]).toMatchObject({ projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] })
    expect((await store.list(projects)).workspaces[1]?.projectIds).toEqual([])
    await expect(store.ensureOpen("project-1", projects)).resolves.toBeDefined()
    await expect(store.remove(initial.workspaces[0]!.id, projects)).resolves.toMatchObject({ workspaces: [{ id: target }] })
  })

  it("migrates only open normal top-level Sessions once", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    await writeFile(join(data, "workspaces.json"), JSON.stringify({ version: 2, workspaces: [{ id: "one", name: "One", projectIds: ["project-1"], closedProjectIds: [], bookmarkedProjectIds: [] }], activeWorkspaceId: "one" }))
    const store = new WorkspaceStore(data)
    const sessions = [
      { id: "open", projectId: "project-1", path: "/open", modifiedAt: "2026-01-01", state: "open" as const },
      { id: "closed", projectId: "project-1", path: "/closed", modifiedAt: "2026-01-01", state: "closed" as const },
      { id: "child", projectId: "project-1", path: "/child", modifiedAt: "2026-01-01", state: "open" as const, parentSessionId: "open" },
      { id: "quick", projectId: "project-1", path: "/quick", modifiedAt: "2026-01-01", state: "open" as const, quickSession: true as const },
    ]
    const migrated = await store.list(projects, [], sessions)
    expect(migrated.workspaces[0]?.tabs.map(({ sessionId }) => sessionId)).toEqual(["open"])
    await store.closeTab("one", migrated.workspaces[0]!.tabs[0]!.id, projects, sessions)
    expect((await store.list(projects, [], sessions)).workspaces[0]?.tabs).toEqual([])
  })

  it("uses the central Session source for the first rename operation", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const open = { id: "open", projectId: "project-2", path: "/open", modifiedAt: "2026-01-01", state: "open" as const }
    const store = new WorkspaceStore(data, () => Promise.resolve([open]))
    const initial = await store.list(projects)
    expect(initial.workspaces[0]?.tabs.map(({ sessionId }) => sessionId)).toEqual(["open"])

    const otherData = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    await writeFile(join(otherData, "workspaces.json"), JSON.stringify({ version: 2, workspaces: [{ id: "legacy", name: "Old", projectIds: ["project-2"], closedProjectIds: [], bookmarkedProjectIds: [] }], activeWorkspaceId: "legacy" }))
    const other = new WorkspaceStore(otherData, () => Promise.resolve([open]))
    const renamed = await other.update("legacy", { name: "Renamed" }, projects)
    expect(renamed.workspaces[0]?.tabs.map(({ sessionId }) => sessionId)).toEqual(["open"])
  })

  it("rejects unsafe migration size and duplicate tab order", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const many = Array.from({ length: 101 }, (_, index) => ({ id: `session-${index}`, projectId: "project-2", path: `/session-${index}`, modifiedAt: "2026-01-01", state: "open" as const }))
    const store = new WorkspaceStore(data, () => Promise.resolve(many))
    await expect(store.list(projects)).rejects.toMatchObject({ code: "limit" })
    await expect(store.list(projects, [], many.slice(0, 1))).resolves.toMatchObject({ workspaces: [{ tabs: [{ sessionId: "session-0" }] }] })
    const state = await store.list(projects)
    const workspace = state.workspaces[0]!
    await expect(store.reorderTabs(workspace.id, [workspace.tabs[0]!.id, workspace.tabs[0]!.id], projects, many.slice(0, 1))).rejects.toMatchObject({ code: "invalid" })
  })

  it("manages scoped tabs and Workspace lifecycle without changing Session state", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const store = new WorkspaceStore(data)
    const initial = await store.list(projects)
    const first = initial.workspaces[0]!.id
    const second = (await store.create({ name: "Other" }, projects)).workspaces[1]!.id
    const opened = await store.openSession(second, "project-1", "session-1", projects)
    const tab = opened.workspaces[1]!.tabs[0]!
    expect((await store.openSession(second, "project-1", "session-1", projects)).workspaces[1]?.tabs).toHaveLength(1)
    expect((await store.select(second, projects)).activeWorkspaceId).toBe(first)
    await expect(store.setWorkspaceClosed(first, true, projects)).resolves.toBeDefined()
    await expect(store.setWorkspaceClosed(second, true, projects)).rejects.toMatchObject({ code: "conflict" })
    await store.setWorkspaceClosed(first, false, projects)
    await store.closeTab(second, tab.id, projects)
    expect((await store.remove(second, projects)).workspaces.map(({ id }) => id)).toEqual([first])
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
    expect(opened.workspaces.find(({ id }) => id === second)?.closedProjectIds).toEqual([])
  })
})
