// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@pi-station/application-protocol";
import type { SessionSummary } from "../application/workspace-model";
import { WorkspaceRow, workspaceActivity } from "./WorkspaceRow";

afterEach(cleanup);

const workspace = (id: string, name: string, tabs: Workspace["tabs"] = [], closedAt?: string): Workspace => ({
  id, name, tabs, ...(closedAt === undefined ? {} : { closedAt }), projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [],
});
const session = (hostId: string, piSessionId: string, options: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionKey: { hostId, piSessionId }, projectId: "project", projection: {
    availability: "available", synchronization: "synchronized", run: "idle", queue: { state: "empty", knownCount: 0 },
    unread: { hasUnread: false }, management: { kind: "unmanaged" }, capabilities: [],
  }, ...options,
});
const callbacks = () => ({
  onActivate: vi.fn(() => Promise.resolve()), onCreate: vi.fn(() => Promise.resolve()),
  onRename: vi.fn(() => Promise.resolve()), onClose: vi.fn(() => Promise.resolve()),
  onRestore: vi.fn(() => Promise.resolve()), onDelete: vi.fn(() => Promise.resolve()),
});

describe("workspaceActivity", () => {
  it("counts recursive descendants once with complete Session identities", () => {
    const root = session("project", "root", { projection: { ...session("x", "x").projection, run: "working" } });
    const child = session("project", "child", { parentSessionKey: root.sessionKey, projection: { ...root.projection, run: "idle", unread: { hasUnread: true } } });
    const grandchild = session("project", "grandchild", { parentSessionKey: child.sessionKey, delegationStatus: "working" });
    const sameIdOtherHost = session("other-project", "child", { parentSessionKey: { hostId: "other-project", piSessionId: "root" }, delegationStatus: "working" });
    const value = workspace("one", "One", [
      { id: "tab-1", kind: "session", projectId: "project", sessionId: "root" },
      { id: "tab-2", kind: "session", projectId: "project", sessionId: "child" },
    ]);
    expect(workspaceActivity(value, [root, child, grandchild, sameIdOtherHost])).toEqual({ working: 2, unread: 1 });
  });
});

describe("WorkspaceRow", () => {
  it("shows open Workspaces in collection order, status counts, and overflow structure", () => {
    const activeSession = session("project", "one", { delegationStatus: "working", projection: { ...session("x", "x").projection, unread: { hasUnread: true } } });
    const view = render(<WorkspaceRow workspaces={[
      workspace("first", "First", [{ id: "tab", kind: "session", projectId: "project", sessionId: "one" }]),
      workspace("closed", "Hidden", [], "2026-01-01T00:00:00Z"), workspace("second", "Second"),
    ]} activeWorkspaceId="first" sessions={[activeSession]} {...callbacks()} />);
    const tabs = screen.getByTestId("workspace-row-scroll");
    expect(tabs).toHaveClass("workspace-row-tabs");
    expect([...view.container.querySelectorAll(".workspace-row-activate")].map((button) => button.textContent)).toEqual(["First1 working1 unread", "Second"]);
    expect(view.container.querySelector(".workspace-row-name")).toHaveAttribute("title", "First");
    expect(screen.queryByRole("button", { name: "Hidden" })).not.toBeInTheDocument();
    const css = readFileSync(resolve(process.cwd(), "src/components/workspace-row.css"), "utf8");
    expect(css).toMatch(/height:\s*44px/);
    expect(css).toMatch(/overflow-x:\s*auto/);
    expect(css).toMatch(/min-width:\s*140px/);
    expect(css).toMatch(/max-width:\s*240px/);
    expect(css).not.toMatch(/\.workspace-row-status\s*{[^}]*display:\s*none/s);
  });

  it("creates, activates, renames, and closes with the exact callbacks", async () => {
    const actions = callbacks();
    render(<WorkspaceRow workspaces={[workspace("one", "One"), workspace("two", "Two")]} activeWorkspaceId="one" sessions={[]} {...actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Create Workspace" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Workspace name" }), "Three");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(actions.onCreate).toHaveBeenCalledWith("Three");
    expect(actions.onActivate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Two" }));
    expect(actions.onActivate).toHaveBeenCalledWith("two");
    await userEvent.click(screen.getByRole("button", { name: "Actions for One" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Workspace name" });
    await userEvent.clear(input); await userEvent.type(input, "Primary");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(actions.onRename).toHaveBeenCalledWith("one", "Primary");
    await userEvent.click(screen.getByRole("button", { name: "Actions for One" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Close" }));
    expect(actions.onClose).toHaveBeenCalledWith("one");
  });

  it("restores closed Workspaces and offers delete only in the closed list", async () => {
    const actions = callbacks();
    render(<WorkspaceRow workspaces={[workspace("one", "One"), workspace("old", "Old", [], "2026-01-01T00:00:00Z")]} activeWorkspaceId="one" sessions={[]} {...actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Closed (1)" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(actions.onRestore).toHaveBeenCalledWith("old");
    expect(actions.onActivate).not.toHaveBeenCalled();
  });

  it("shows row action errors and remains usable after StrictMode effect replay", async () => {
    const actions = callbacks();
    actions.onActivate.mockRejectedValueOnce(new Error("Activate failed"));
    render(<StrictMode><WorkspaceRow workspaces={[workspace("one", "One"), workspace("two", "Two")]} activeWorkspaceId="one" sessions={[]} {...actions} /></StrictMode>);
    await userEvent.click(screen.getByRole("button", { name: "Two" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Activate failed");
    await userEvent.click(screen.getByRole("button", { name: "Two" }));
    await waitFor(() => expect(actions.onActivate).toHaveBeenCalledTimes(2));
  });

  it("dismisses a failed close and permits retry and create", async () => {
    const actions = callbacks();
    actions.onClose.mockRejectedValueOnce(new Error("Close failed"));
    render(<WorkspaceRow workspaces={[workspace("one", "One")]} activeWorkspaceId="one" sessions={[]} {...actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for One" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Close" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Close failed");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss Workspace error" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Actions for One" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(actions.onClose).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Create Workspace" }));
    expect(screen.getByRole("dialog", { name: "Create Workspace" })).toBeInTheDocument();
  });

  it("reports dialog callback errors and enables a retry", async () => {
    const actions = callbacks();
    actions.onCreate.mockRejectedValueOnce(new Error("Create failed"));
    render(<WorkspaceRow workspaces={[workspace("one", "One")]} activeWorkspaceId="one" sessions={[]} {...actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Create Workspace" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Workspace name" }), "New");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Create failed");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(actions.onCreate).toHaveBeenCalledTimes(2));
  });
});
