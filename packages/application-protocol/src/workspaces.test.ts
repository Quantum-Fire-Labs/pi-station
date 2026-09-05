import { describe, expect, it } from "vitest"
import { isWorkspaceCreateMutation, isWorkspaceOpenSessionMutation, isWorkspaceReorderTabsMutation, isWorkspaceState, isWorkspaceUpdateMutation } from "./workspaces.js"

const tab = { id: "tab-1", kind: "session", projectId: "project-2", sessionId: "session-1" }
const workspace = { id: "workspace-1", name: "Main", tabs: [tab], activeTabId: tab.id, projectIds: ["project-2", "project-1"], closedProjectIds: ["project-2"], bookmarkedProjectIds: ["project-1"] }

describe("Workspace protocol", () => {
  it("accepts tabs, lifecycle data, and strict mutations", () => {
    expect(isWorkspaceCreateMutation({ name: "Main" })).toBe(true)
    expect(isWorkspaceUpdateMutation({ name: "Renamed" })).toBe(true)
    expect(isWorkspaceOpenSessionMutation({ projectId: "project-1", sessionId: "session-1" })).toBe(true)
    expect(isWorkspaceReorderTabsMutation({ tabIds: ["tab-2", "tab-1"] })).toBe(true)
    expect(isWorkspaceState({ workspaces: [workspace, { ...workspace, id: "workspace-2", closedAt: "2026-02-01T00:00:00.000Z" }], activeWorkspaceId: workspace.id })).toBe(true)
  })

  it("rejects extra mutation fields and invalid state", () => {
    expect(isWorkspaceUpdateMutation({ projectIds: [] })).toBe(false)
    expect(isWorkspaceOpenSessionMutation({ projectId: "project-1", sessionId: "session-1", extra: true })).toBe(false)
    expect(isWorkspaceReorderTabsMutation({ tabIds: ["tab-1", "tab-1"] })).toBe(false)
    expect(isWorkspaceState({ workspaces: [{ ...workspace, activeTabId: "missing" }], activeWorkspaceId: workspace.id })).toBe(false)
    expect(isWorkspaceState({ workspaces: [{ ...workspace, tabs: [tab, { ...tab, id: "tab-2" }] }], activeWorkspaceId: workspace.id })).toBe(false)
    expect(isWorkspaceState({ workspaces: [workspace], activeWorkspaceId: "missing" })).toBe(false)
  })
})
