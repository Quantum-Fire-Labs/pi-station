import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { WorkspaceStore, WorkspaceStoreError } from "../workspace-store.js"

const projects = [{ id: "project-1", root: "/one" }, { id: "project-2", root: "/two" }]

describe("WorkspaceStore", () => {
  it("persists ordered membership and active selection", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const store = new WorkspaceStore(data)
    const created = await store.create({ name: "Main" })
    const id = created.workspaces[0]!.id
    expect(created).toMatchObject({ activeWorkspaceId: id, workspaces: [{ name: "Main", projectIds: [] }] })
    await store.update(id, { projectIds: ["project-2", "project-1"] }, projects)
    await store.update(id, { name: "Renamed", projectIds: ["project-1"] }, projects)
    expect(await new WorkspaceStore(data).list()).toMatchObject({ activeWorkspaceId: id, workspaces: [{ id, name: "Renamed", projectIds: ["project-1"] }] })
    expect(await store.select(undefined)).toEqual({ workspaces: [{ id, name: "Renamed", projectIds: ["project-1"] }] })
  })

  it("validates Projects and repairs membership when a Project is removed", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-workspaces-"))
    const store = new WorkspaceStore(data)
    const invalid = await store.create({ name: "Bad" })
    await expect(store.update(invalid.workspaces[0]!.id, { projectIds: ["missing"] }, projects)).rejects.toBeInstanceOf(WorkspaceStoreError)
    await store.remove(invalid.workspaces[0]!.id)
    const first = await store.create({ name: "First" })
    await store.update(first.workspaces[0]!.id, { projectIds: ["project-1", "project-2"] }, projects)
    const second = await store.create({ name: "Second" })
    await store.update(second.workspaces[1]!.id, { projectIds: ["project-2"] }, projects)
    expect((await store.removeProject("project-2")).workspaces.map(({ projectIds }) => projectIds)).toEqual([["project-1"], []])
    const removed = await store.remove(first.workspaces[0]!.id)
    expect(removed.activeWorkspaceId).toBe(removed.workspaces[0]!.id)
  })
})
