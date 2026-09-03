import { describe, expect, it } from "vitest"
import { isWorkspaceCreateMutation, isWorkspaceSessionMutation, isWorkspaceState, isWorkspaceUpdateMutation } from "./workspaces.js"

const workspace = { id: "workspace-1", name: "Main", projectIds: ["project-2", "project-1"], closedProjectIds: ["project-2"], bookmarkedProjectIds: ["project-1"] }

describe("Workspace protocol", () => {
  it("accepts exclusive Project ownership and per-Workspace state", () => {
    expect(isWorkspaceCreateMutation({ name: "Main" })).toBe(true)
    expect(isWorkspaceUpdateMutation({ name: "Renamed" })).toBe(true)
    expect(isWorkspaceSessionMutation({ projectId: "project-1", sessionId: "session-1" })).toBe(true)
    expect(isWorkspaceState({ workspaces: [{ ...workspace, lastSession: { projectId: "project-1", sessionId: "session-1" } }, { ...workspace, id: "workspace-2", projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] }], activeWorkspaceId: workspace.id })).toBe(true)
  })

  it("rejects membership edits and invalid state", () => {
    expect(isWorkspaceUpdateMutation({ projectIds: [] })).toBe(false)
    expect(isWorkspaceSessionMutation({ projectId: "project-1", sessionId: "session-1", extra: true })).toBe(false)
    expect(isWorkspaceState({ workspaces: [{ ...workspace, closedProjectIds: ["missing"] }], activeWorkspaceId: workspace.id })).toBe(false)
    expect(isWorkspaceState({ workspaces: [workspace], activeWorkspaceId: "missing" })).toBe(false)
    expect(isWorkspaceState({ workspaces: [workspace, { ...workspace, id: "workspace-2" }], activeWorkspaceId: workspace.id })).toBe(false)
  })
})
