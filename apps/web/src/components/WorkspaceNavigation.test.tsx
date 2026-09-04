import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@pi-station/application-protocol";
import type { ProjectSummary, SessionSummary } from "../application/workspace-model";
import { groupWorkspaceTabs, WorkspaceNavigation } from "./WorkspaceNavigation";

beforeAll(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

const projection: SessionSummary["projection"] = {
  availability: "available", synchronization: "synchronized", run: "idle",
  queue: { state: "empty", knownCount: 0 }, unread: { hasUnread: false },
  management: { kind: "unmanaged" }, capabilities: [],
};
const session = (id: string, name: string, projectId = "project-1"): SessionSummary => ({
  sessionKey: { hostId: projectId, piSessionId: id }, name, projectId, projection,
});
const workspace: Workspace = {
  id: "workspace-1", name: "Delivery", projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [],
  tabs: [{ id: "tab-1", kind: "session", projectId: "project-1", sessionId: "session-1" }], activeTabId: "tab-1",
};

const project = (projectId: string, name: string): ProjectSummary => ({ projectId, name, displayPath: `/${projectId}`, available: true, createdAt: "", updatedAt: "" });
const projects = [project("project-1", "Pi Station"), project("project-2", "Client")];

const renderNavigation = (sessions = [session("session-1", "Open work"), session("session-2", "Saved work")]) => {
  const actions = { onSelectTab: vi.fn(), onCloseTab: vi.fn(), onOpenSession: vi.fn(), onNewSession: vi.fn(), onNewSessionInProject: vi.fn() };
  render(<WorkspaceNavigation workspace={workspace} projects={projects} sessions={sessions} {...actions} />);
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

  it("uses the selected Session instead of a stale active tab", () => {
    const second = session("session-2", "Selected work");
    const twoTabs: Workspace = { ...workspace, tabs: [...workspace.tabs, { id: "tab-2", kind: "session", projectId: "project-1", sessionId: "session-2" }] };
    render(<WorkspaceNavigation workspace={twoTabs} projects={[{ projectId: "project-1", name: "Pi Station", displayPath: "/repo", available: true, createdAt: "", updatedAt: "" }]} sessions={[session("session-1", "Open work"), second]} selectedSessionKey={second.sessionKey} onSelectTab={vi.fn()} onCloseTab={vi.fn()} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(screen.getByRole("button", { current: "page" })).toHaveTextContent("Selected work");
    expect(screen.getByText("Open work").closest("button")).not.toHaveAttribute("aria-current");
  });

  it("shows the configured Project and visible status", () => {
    renderNavigation([{ ...session("session-1", "Open work"), projection: { ...projection, run: "working", unread: { hasUnread: true } } }]);
    expect(screen.getByText("Pi Station")).toBeVisible();
    expect(screen.getByText("Working · Unread")).toBeVisible();
  });

  it("keeps a missing Session reference inert and explains it", () => {
    renderNavigation([]);
    expect(screen.getByRole("button", { name: /Session unavailable/ })).toBeDisabled();
    expect(screen.getByText("Referenced Session was not found.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove unavailable Session tab" })).toBeEnabled();
  });

  it("groups tabs by first Project occurrence and preserves Session order", () => {
    const tabs: Workspace["tabs"] = [
      { id: "a", kind: "session", projectId: "project-2", sessionId: "a" },
      { id: "b", kind: "session", projectId: "project-1", sessionId: "b" },
      { id: "c", kind: "session", projectId: "project-2", sessionId: "c" },
    ];
    const groups = groupWorkspaceTabs(tabs, projects);
    expect(groups.map((group) => group.projectId)).toEqual(["project-2", "project-1"]);
    expect(groups[0]?.tabs.map((tab) => tab.sessionId)).toEqual(["a", "c"]);
  });

  it("collapses a Project per Workspace and numbers only visible Session rows", async () => {
    const groupedWorkspace: Workspace = { ...workspace, tabs: [
      ...workspace.tabs,
      { id: "tab-2", kind: "session", projectId: "project-2", sessionId: "session-2" },
    ] };
    render(<WorkspaceNavigation workspace={groupedWorkspace} projects={projects} sessions={[session("session-2", "Second", "project-2")]} onSelectTab={vi.fn()} onCloseTab={vi.fn()} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Session unavailable/ })).not.toHaveAttribute("data-session-shortcut");
    await userEvent.click(screen.getByRole("button", { name: "Pi Station" }));
    expect(screen.queryByText("Session unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("Second").closest("button")).toHaveAttribute("data-session-shortcut", "1");
    expect(window.localStorage.getItem("pi-station:workspace-navigation:workspace-1:collapsed-projects")).toContain("project-1");
  });

  it("expands the selected Project and uses complete Session identity hooks", async () => {
    window.localStorage.setItem("pi-station:workspace-navigation:workspace-1:collapsed-projects", JSON.stringify(["project-2"]));
    const second = session("shared", "Selected", "project-2");
    const sameId = session("shared", "Other host", "project-1");
    const groupedWorkspace: Workspace = { ...workspace, tabs: [
      { id: "tab-1", kind: "session", projectId: "project-1", sessionId: "shared" },
      { id: "tab-2", kind: "session", projectId: "project-2", sessionId: "shared" },
    ] };
    render(<WorkspaceNavigation workspace={groupedWorkspace} projects={projects} sessions={[sameId, second]} selectedSessionKey={second.sessionKey} onSelectTab={vi.fn()} onCloseTab={vi.fn()} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    expect(await screen.findByText("Selected")).toBeVisible();
    expect(screen.getByText("Selected").closest("button")).toHaveAttribute("data-session-identity", "project-2:shared");
  });

  it("adds expanded delegated children to the visible keyboard order", async () => {
    const parent = session("session-1", "Parent");
    const child: SessionSummary = { ...session("child", "Child"), parentSessionKey: parent.sessionKey, projection: { ...projection, unread: { hasUnread: true } } };
    const actions = renderNavigation([parent, child]);
    expect(screen.getByText("Parent").closest("button")).toHaveAttribute("data-session-shortcut", "1");
    await userEvent.click(screen.getByRole("button", { name: "1 agent" }));
    const childButton = screen.getByRole("button", { name: "Child: Unread" });
    expect(childButton).toHaveClass("workspace-tab-open");
    expect(childButton).toHaveAttribute("data-session-identity", "project-1:child");
    expect(childButton).toHaveAttribute("data-session-shortcut", "2");
    expect(childButton).toHaveAttribute("data-unread", "true");
    await userEvent.click(childButton);
    expect(actions.onOpenSession).toHaveBeenCalledWith(child);
  });

  it("renders an open child once under its parent and makes it removable", async () => {
    const parent = session("session-1", "Parent");
    const child: SessionSummary = { ...session("child", "Child"), parentSessionKey: parent.sessionKey };
    const childTab = { id: "child-tab", kind: "session" as const, projectId: "project-1", sessionId: "child" };
    const groupedWorkspace: Workspace = { ...workspace, tabs: [...workspace.tabs, childTab], activeTabId: childTab.id };
    const actions = { onSelectTab: vi.fn(), onCloseTab: vi.fn(), onOpenSession: vi.fn(), onNewSession: vi.fn() };
    const view = render(<WorkspaceNavigation workspace={groupedWorkspace} projects={projects} sessions={[parent, child]} {...actions} />);
    const selectedChild = await screen.findByRole("button", { name: "Child: Idle" });
    expect(screen.getAllByText("Child")).toHaveLength(1);
    expect(selectedChild).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Remove Child tab" }));
    expect(actions.onCloseTab).toHaveBeenCalledWith(childTab, child);

    view.rerender(<WorkspaceNavigation workspace={{ ...groupedWorkspace, tabs: [childTab] }} projects={projects} sessions={[parent, child]} {...actions} />);
    expect(screen.queryByRole("button", { name: "Child: Idle" })).not.toBeInTheDocument();
    expect(screen.getByText("Child").closest("button")).toHaveClass("workspace-tab-open");
  });

  it("keeps a delegated group collapsed on status changes and restores it on Workspace switch", async () => {
    const parent = session("session-1", "Parent");
    const child = { ...session("child", "Child"), parentSessionKey: parent.sessionKey };
    const tabs: Workspace["tabs"] = [...workspace.tabs, { id: "child-tab", kind: "session", projectId: "project-1", sessionId: "child" }];
    const props = { projects, selectedSessionKey: child.sessionKey, onSelectTab: vi.fn(), onCloseTab: vi.fn(), onOpenSession: vi.fn(), onNewSession: vi.fn() };
    const view = render(<WorkspaceNavigation workspace={{ ...workspace, tabs }} sessions={[parent, child]} {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "1 agent" }));
    expect(screen.getByRole("button", { name: "1 agent" })).toHaveAttribute("aria-expanded", "false");
    const workingChild = { ...child, projection: { ...projection, run: "working" as const } };
    view.rerender(<WorkspaceNavigation workspace={{ ...workspace, tabs }} sessions={[parent, workingChild]} {...props} />);
    expect(screen.getByRole("button", { name: "1 agent · 1 working" })).toHaveAttribute("aria-expanded", "false");
    view.rerender(<WorkspaceNavigation workspace={{ ...workspace, id: "another", tabs }} sessions={[parent, workingChild]} {...props} />);
    expect(await screen.findByRole("button", { name: "Child: Working" })).toBeVisible();
  });

  it("renders a selected grandchild once in recursive depth-first order", async () => {
    const root = session("session-1", "Root");
    const child: SessionSummary = { ...session("child", "Child"), parentSessionKey: root.sessionKey };
    const grandchild: SessionSummary = { ...session("grandchild", "Grandchild"), parentSessionKey: child.sessionKey };
    const childTab = { id: "child-tab", kind: "session" as const, projectId: "project-1", sessionId: "child" };
    const grandchildTab = { id: "grandchild-tab", kind: "session" as const, projectId: "project-1", sessionId: "grandchild" };
    const recursiveWorkspace: Workspace = { ...workspace, tabs: [...workspace.tabs, childTab, grandchildTab], activeTabId: grandchildTab.id };
    render(<WorkspaceNavigation workspace={recursiveWorkspace} projects={projects} sessions={[root, child, grandchild]} onSelectTab={vi.fn()} onCloseTab={vi.fn()} onOpenSession={vi.fn()} onNewSession={vi.fn()} />);
    const selectedGrandchild = await screen.findByRole("button", { name: "Grandchild: Idle" });
    expect(screen.getAllByText("Grandchild")).toHaveLength(1);
    expect(selectedGrandchild).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Root").closest("button")).toHaveAttribute("data-session-shortcut", "1");
    expect(screen.getByRole("button", { name: "Child: Idle" })).toHaveAttribute("data-session-shortcut", "2");
    expect(selectedGrandchild).toHaveAttribute("data-session-shortcut", "3");
  });

  it("shows collapsed Project activity and starts a Session in that Project", async () => {
    const working = { ...session("session-1", "Open work"), projection: { ...projection, run: "working" as const, unread: { hasUnread: true } } };
    const actions = renderNavigation([working, working]);
    await userEvent.click(screen.getByRole("button", { name: "Pi Station" }));
    expect(screen.getByText("1 working · 1 unread")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "New Session in Pi Station" }));
    expect(actions.onNewSessionInProject).toHaveBeenCalledWith(projects[0]);
  });
});
