// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@pi-station/application-protocol";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

afterEach(cleanup);
const workspace = (id: string, name: string): Workspace => ({ id, name, tabs: [], projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] });

describe("WorkspaceSwitcher", () => {
  it("selects a newly created Workspace after state includes it", async () => {
    const onActivate = vi.fn(() => Promise.resolve());
    const onCreate = vi.fn(() => Promise.resolve());
    const props = { activeWorkspaceId: "one", onActivate, onCreate, onRename: vi.fn(), onDelete: vi.fn(), onCloseWorkspace: vi.fn(), onRestoreWorkspace: vi.fn(), onOpenQuickSession: vi.fn(), onNewSession: vi.fn(), children: null };
    const view = render(<WorkspaceSwitcher {...props} workspaces={[workspace("one", "One")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Select Workspace" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New Workspace" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Workspace name" }), "Two");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith("Two");
    view.rerender(<WorkspaceSwitcher {...props} workspaces={[workspace("one", "One"), workspace("two", "Two")]} />);
    expect(onActivate).toHaveBeenCalledWith("two");
  });
});
