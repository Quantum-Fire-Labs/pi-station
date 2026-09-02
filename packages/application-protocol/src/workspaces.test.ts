import { describe, expect, it } from "vitest"
import { isWorkspaceCreateMutation, isWorkspaceState, isWorkspaceUpdateMutation } from "./workspaces.js"

const workspace = { id: "workspace-1", name: "Main", projectIds: ["project-2", "project-1"], closedProjectIds: ["project-2"], bookmarkedProjectIds: ["project-1"] }

describe("Workspace protocol", () => {
  it("accepts shared Project membership and per-Workspace state", () => {
    expect(isWorkspaceCreateMutation({ name: "Main" })).toBe(true)
    expect(isWorkspaceUpdateMutation({ name: "Renamed" })).toBe(true)
    expect(isWorkspaceState({ workspaces: [workspace, { ...workspace, id: "workspace-2" }], activeWorkspaceId: workspace.id })).toBe(true)
  })

  it("rejects membership edits and invalid state", () => {
    expect(isWorkspaceUpdateMutation({ projectIds: [] })).toBe(false)
    expect(isWorkspaceState({ workspaces: [{ ...workspace, closedProjectIds: ["missing"] }], activeWorkspaceId: workspace.id })).toBe(false)
    expect(isWorkspaceState({ workspaces: [workspace], activeWorkspaceId: "missing" })).toBe(false)
  })
})
