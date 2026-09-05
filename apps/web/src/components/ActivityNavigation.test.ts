import { describe, expect, it } from "vitest";
import type { Workspace } from "@pi-station/application-protocol";
import { activityWorkspaceTarget } from "./Workspace";

const tab = { id: "target-tab", kind: "session" as const, projectId: "project", sessionId: "target" };
const workspace = (id: string, options: { closed?: boolean; target?: boolean } = {}): Workspace => ({
  id,
  name: id,
  tabs: options.target ? [tab] : [],
  ...(options.target ? { activeTabId: tab.id } : {}),
  ...(options.closed ? { closedAt: "2026-01-01T00:00:00.000Z" } : {}),
  projectIds: [],
  closedProjectIds: [],
  bookmarkedProjectIds: [],
});
const key = { hostId: "project", piSessionId: "target" };

describe("activityWorkspaceTarget", () => {
  it("prefers the current open Workspace, then browser-local MRU", () => {
    const workspaces = [workspace("first", { target: true }), workspace("current", { target: true }), workspace("recent", { target: true })];
    expect(activityWorkspaceTarget(workspaces, "current", key, ["recent", "first"])?.workspace.id).toBe("current");
    expect(activityWorkspaceTarget(workspaces, "other", key, ["recent", "first"])?.workspace.id).toBe("recent");
  });

  it("uses source order as a deterministic fallback and never restores a closed Workspace", () => {
    const workspaces = [workspace("closed", { target: true, closed: true }), workspace("first", { target: true }), workspace("second", { target: true })];
    expect(activityWorkspaceTarget(workspaces, "other", key, [])?.workspace.id).toBe("first");
    expect(activityWorkspaceTarget([workspaces[0]!], "closed", key, ["closed"])).toBeUndefined();
  });
});
