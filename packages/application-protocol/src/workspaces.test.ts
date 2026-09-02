import { describe, expect, it } from "vitest"
import { isWorkspaceCreateMutation, isWorkspaceState, isWorkspaceUpdateMutation } from "./workspaces.js"

const workspace = { id: "workspace-1", name: "Main", projectIds: ["project-2", "project-1"] }

describe("Workspace protocol", () => {
  it("accepts strict ordered Workspace data and active selection", () => {
    expect(isWorkspaceCreateMutation({ name: "Main" })).toBe(true)
    expect(isWorkspaceUpdateMutation({ name: "Renamed" })).toBe(true)
    expect(isWorkspaceUpdateMutation({ projectIds: ["project-2", "project-1"] })).toBe(true)
    expect(isWorkspaceState({ workspaces: [workspace], activeWorkspaceId: workspace.id })).toBe(true)
  })

  it("rejects invalid names, duplicate Projects, extra keys, and stale active selection", () => {
    expect(isWorkspaceCreateMutation({ name: " Main" })).toBe(false)
    expect(isWorkspaceCreateMutation({ name: "Main", projectIds: [] })).toBe(false)
    expect(isWorkspaceUpdateMutation({ projectIds: ["project-1", "project-1"] })).toBe(false)
    expect(isWorkspaceUpdateMutation({})).toBe(false)
    expect(isWorkspaceUpdateMutation({ name: "Main", extra: true })).toBe(false)
    expect(isWorkspaceState({ workspaces: [workspace], activeWorkspaceId: "missing" })).toBe(false)
    expect(isWorkspaceState({ workspaces: [workspace, workspace] })).toBe(false)
  })
})
