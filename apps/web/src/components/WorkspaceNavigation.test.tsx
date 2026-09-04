import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@pi-station/application-protocol";
import type { SessionSummary } from "../application/workspace-model";
import { WorkspaceNavigation } from "./WorkspaceNavigation";

afterEach(cleanup);

const projection: SessionSummary["projection"] = {
  availability: "available", synchronization: "synchronized", run: "idle",
  queue: { state: "empty", knownCount: 0 }, unread: { hasUnread: false },
  management: { kind: "unmanaged" }, capabilities: [],
};
const session = (id: string, name: string, projectId = "project-1"): SessionSummary => ({
  sessionKey: { hostId: "local", piSessionId: id }, name, projectId, projection,
});
const workspace: Workspace = {
  id: "workspace-1", name: "Delivery", projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [],
  tabs: [{ id: "tab-1", kind: "session", projectId: "project-1", sessionId: "session-1" }], activeTabId: "tab-1",
};

const renderNavigation = (sessions = [session("session-1", "Open work"), session("session-2", "Saved work")]) => {
  const actions = { onSelectTab: vi.fn(), onCloseTab: vi.fn(), onOpenSession: vi.fn(), onNewSession: vi.fn() };
  render(<WorkspaceNavigation workspace={workspace} sessions={sessions} {...actions} />);
  return actions;
};

describe("WorkspaceNavigation", () => {
  it("removes a tab without requesting Session close", async () => {
    const actions = renderNavigation();
    await userEvent.click(screen.getByRole("button", { name: "Remove Open work tab" }));
    expect(actions.onCloseTab).toHaveBeenCalledWith(workspace.tabs?.[0], expect.objectContaining({ name: "Open work" }));
  });

  it("opens saved Sessions from the global library", async () => {
    const actions = renderNavigation();
    await userEvent.click(screen.getByRole("button", { name: /Open saved Session/ }));
    await userEvent.click(screen.getByRole("listitem", { name: /Saved work/ }));
    expect(actions.onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ name: "Saved work" }));
  });

  it("keeps a missing Session reference inert", () => {
    renderNavigation([]);
    expect(screen.getByRole("button", { name: /Session unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove unavailable Session tab" })).toBeEnabled();
  });
});
