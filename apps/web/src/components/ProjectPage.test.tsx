// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fixtureState } from "../fixtures/workspace";
import type { ApplicationClient } from "../application/application-client";
import { ProjectPage } from "./ProjectPage";

afterEach(cleanup);

type ProjectPageProps = ComponentProps<typeof ProjectPage>;

const project = fixtureState.projects[0]!;
const baseProps: ProjectPageProps = {
  state: fixtureState,
  project,
  onBack: vi.fn(),
  onNewSession: vi.fn(),
  onOpenSession: vi.fn(),
  onSetProjectBookmark: vi.fn(),
  onRemoveProject: vi.fn(),
  onRemoved: vi.fn(),
  onSetSessionBookmark: vi.fn(),
  onReorderSessionBookmark: vi.fn(),
  onConfigureDevelopmentServer: vi.fn(),
};

function renderProjectPage(overrides: Partial<ProjectPageProps> = {}) {
  return render(<ProjectPage {...baseProps} {...overrides} />);
}

function projectSessionId(id: string, source = fixtureState.sessions[0]!) {
  return {
    ...source,
    sessionKey: { ...source.sessionKey, piSessionId: id },
  };
}

describe("ProjectPage navigation", () => {
  it("uses controlled stock Tabs with Sessions as the default and keeps the breadcrumb navigation link", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderProjectPage({ onBack });

    const tabs = screen.getByRole("tablist", { name: `${project.name} sections` });
    expect(tabs).toHaveAttribute("data-slot", "tabs-list");
    expect(screen.getByRole("tab", { name: "Previous Sessions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Previous Sessions" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Previous Sessions" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search Previous Sessions" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    const projectsLink = within(breadcrumb).getByRole("link", { name: "Projects" });
    expect(projectsLink).toHaveAttribute("href", "#projects");
    await user.click(projectsLink);
    expect(onBack).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Open" })).not.toBeInTheDocument();
  });

  it("shows the Folder header, safe Project path, and unavailable state", () => {
    const unavailable = { ...project, available: false, displayPath: "~/a/path/that/should/wrap/safely" };
    renderProjectPage({ project: unavailable });

    expect(screen.getByRole("heading", { name: unavailable.name, level: 1 })).toBeVisible();
    expect(screen.getByRole("heading", { name: unavailable.name, level: 1 }).previousElementSibling?.querySelector(".lucide-folder"))
      .toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByText("Unavailable")).toHaveAttribute("data-variant", "outline");
    expect(screen.getByTitle(unavailable.displayPath)).toHaveTextContent(unavailable.displayPath);
    expect(screen.getByRole("button", { name: "New Session" })).toBeDisabled();
  });

  it("opens and closes the Project from secondary Settings", async () => {
    const user = userEvent.setup();
    const onSetProjectClosed = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderProjectPage({ onSetProjectClosed });

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Close Project" }));
    expect(onSetProjectClosed).toHaveBeenCalledWith(true);

    rerender(<ProjectPage {...baseProps} project={{ ...project, closed: true }} onSetProjectClosed={onSetProjectClosed} />);
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    expect(onSetProjectClosed).toHaveBeenCalledWith(false);
  });

  it("resets the active tab and editable Project state when the Project changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderProjectPage({ client: { renameProject: vi.fn().mockResolvedValue(undefined) } as unknown as ApplicationClient });
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Project name")).toBeVisible();

    const nextProject = fixtureState.projects[1]!;
    rerender(<ProjectPage {...baseProps} project={nextProject} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Previous Sessions" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("heading", { name: nextProject.name, level: 1 })).toBeVisible();
    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
  });
});

describe("ProjectPage Sessions", () => {
  it("keeps the three Session groups in one-column stock Cards, preserves ordering and fallbacks, and collapses Closed Sessions", async () => {
    const user = userEvent.setup();
    const firstBookmarked = { ...projectSessionId("bookmarked-first"), name: "First Bookmark", lastActivityAt: "2026-08-10T00:00:00.000Z" };
    const secondBookmarked = { ...projectSessionId("bookmarked-second"), name: "Second Bookmark", lastActivityAt: "2026-08-11T00:00:00.000Z" };
    const open = { ...projectSessionId("open-newer"), name: "Newer Open", lastActivityAt: "2026-08-12T00:00:00.000Z" };
    const reconnecting = { ...projectSessionId("reconnecting"), name: "Reconnecting Session", lastActivityAt: "2026-08-09T00:00:00.000Z", projection: { ...fixtureState.sessions[0]!.projection, availability: "reconnecting" as const } };
    const closed = { ...projectSessionId("closed-fallback"), name: "", lastActivityAt: "2026-08-08T00:00:00.000Z", projection: { ...fixtureState.sessions[0]!.projection, availability: "closed" as const, capabilities: [] } };
    const state = {
      ...fixtureState,
      sessions: [closed, secondBookmarked, reconnecting, firstBookmarked, open],
      sessionBookmarks: [
        { projectId: project.projectId, sessionKey: firstBookmarked.sessionKey, position: 0 },
        { projectId: project.projectId, sessionKey: secondBookmarked.sessionKey, position: 1 },
      ],
    };
    renderProjectPage({ state });

    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
    const bookmarkedCard = screen.getByRole("heading", { name: "Bookmarked" }).closest('[data-slot="card"]');
    const openCard = screen.getByRole("heading", { name: "Open" }).closest('[data-slot="card"]');
    expect(bookmarkedCard).not.toBeNull();
    expect(openCard).not.toBeNull();
    expect(within(bookmarkedCard as HTMLElement).getAllByRole("button", { name: /^Remove .* Bookmark$/ })).toHaveLength(2);
    expect(within(bookmarkedCard as HTMLElement).queryByText("Remove", { exact: true })).not.toBeInTheDocument();
    expect(within(bookmarkedCard as HTMLElement).queryByText("Bookmark", { exact: true })).not.toBeInTheDocument();
    expect([...bookmarkedCard!.querySelectorAll("strong")].map((node) => node.textContent)).toEqual(["First Bookmark", "Second Bookmark"]);
    expect(within(openCard as HTMLElement).getByText("Newer Open")).toBeVisible();
    expect(within(openCard as HTMLElement).getByText("Reconnecting")).toBeVisible();
    expect(screen.queryByText("Untitled Session")).not.toBeInTheDocument();

    const closedTrigger = screen.getByRole("button", { name: "Show Closed Sessions" });
    expect(closedTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Untitled Session/ })).not.toBeInTheDocument();
    await user.click(closedTrigger);
    expect(screen.getByRole("button", { name: /Untitled Session\s*Closed/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Hide Closed Sessions" })).toHaveAttribute("aria-expanded", "true");
  });

  it("preserves Bookmark controls, ordering boundaries, and open status rules", async () => {
    const user = userEvent.setup();
    const first = { ...projectSessionId("bookmark-first"), name: "Bookmark first" };
    const second = { ...projectSessionId("bookmark-second"), name: "Bookmark second" };
    const unknown = { ...projectSessionId("unknown"), name: "Unknown status", projection: { ...fixtureState.sessions[0]!.projection, availability: "unknown" as const } };
    const onSetSessionBookmark = vi.fn(() => "bookmark-request");
    const onReorderSessionBookmark = vi.fn(() => "reorder-request");
    const onOpenSession = vi.fn();
    renderProjectPage({
      state: {
        ...fixtureState,
        sessions: [first, second, unknown],
        sessionBookmarks: [
          { projectId: project.projectId, sessionKey: first.sessionKey, position: 0 },
          { projectId: project.projectId, sessionKey: second.sessionKey, position: 1 },
        ],
      },
      onSetSessionBookmark,
      onReorderSessionBookmark,
      onOpenSession,
    });

    expect(screen.getByRole("button", { name: "Move Bookmark first up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Bookmark first down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Bookmark second down" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Bookmark second up" }));
    expect(onReorderSessionBookmark).toHaveBeenCalledWith(second.sessionKey, "up");

    await user.click(screen.getByRole("button", { name: "Remove Bookmark first Bookmark" }));
    expect(onSetSessionBookmark).toHaveBeenCalledWith(first.sessionKey, false);
    await user.click(screen.getByRole("button", { name: "Show Closed Sessions" }));
    expect(screen.getByRole("button", { name: "Bookmark Unknown status" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Unknown status\s*Closed/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Bookmark Unknown status" }));
    expect(onSetSessionBookmark).toHaveBeenCalledWith(unknown.sessionKey, true);
  });

  it("confirms before it closes every eligible open Session and passes exact Session keys", async () => {
    const user = userEvent.setup();
    const onCloseSessions = vi.fn();
    const state = {
      ...fixtureState,
      sessions: fixtureState.sessions.map((session) => session.projectId === project.projectId
        ? { ...session, projection: { ...session.projection, capabilities: [...session.projection.capabilities, "session.close" as const] } }
        : session),
    };
    renderProjectPage({ state, onCloseSessions });

    await user.click(screen.getByRole("button", { name: "Close all Sessions" }));
    expect(onCloseSessions).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "Close 2 Sessions?" });
    expect(within(dialog).getByText("The saved conversations will remain available.")).toBeVisible();
    expect(within(dialog).getByText("1 working Session will stop.")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Close all Sessions" }));
    expect(onCloseSessions).toHaveBeenCalledWith(state.sessions
      .filter((session) => session.projectId === project.projectId)
      .map((session) => session.sessionKey));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ProjectPage Settings", () => {
  it("uses stacked transparent Cards and preserves Project name validation and trim behavior", async () => {
    const user = userEvent.setup();
    const renameProject = vi.fn().mockResolvedValue(undefined);
    const client = { renameProject } as unknown as ApplicationClient;
    renderProjectPage({ client });

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Project details" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Development Server" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Project Bookmark" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Project availability" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Remove Project" })).toBeVisible();
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Project name");
    await user.clear(input);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(input, "  Station Workspace  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(renameProject).toHaveBeenCalledWith(project.projectId, "Station Workspace");
    expect(screen.getAllByText(project.displayPath)).toHaveLength(2);
  });

  it("preserves Development Server validation, actions, and Project Bookmark callbacks", async () => {
    const user = userEvent.setup();
    const onConfigureDevelopmentServer = vi.fn(() => "server-request");
    const onSetProjectBookmark = vi.fn(() => "bookmark-request");
    renderProjectPage({ onConfigureDevelopmentServer, onSetProjectBookmark });
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Save Development Server" })).toBeDisabled();
    await user.type(screen.getByLabelText(/^Command/), "  npm run dev  ");
    await user.type(screen.getByLabelText(/Preview port/), "3104");
    await user.click(screen.getByRole("button", { name: "Save Development Server" }));
    expect(onConfigureDevelopmentServer).toHaveBeenCalledWith({ command: "npm run dev", previewPort: 3104 });

    await user.click(screen.getByRole("button", { name: "Bookmark Project" }));
    expect(onSetProjectBookmark).toHaveBeenCalledWith(true);
  });

  it("uses AlertDialog for explicit Project removal and keeps the Pi process statement", async () => {
    const user = userEvent.setup();
    const onRemoveProject = vi.fn(() => "remove-1");
    renderProjectPage({ onRemoveProject });
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByText(/does not delete or change the Project directory, files, or Pi Session history/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove Project from Pi Station" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm removal." });
    expect(onRemoveProject).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Open Sessions will leave Pi Station views/i)).toBeVisible();
    expect(within(dialog).getByText(/Working Sessions can finish safely/i)).toBeVisible();
    expect(within(dialog).getByText(/Pi Station will not stop any Pi process/i)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Confirm: Remove Project from Pi Station" }));
    expect(onRemoveProject).toHaveBeenCalledOnce();
  });
});

describe("ProjectPage structure", () => {
  it("keeps Session actions separate from the Session open action", () => {
    renderProjectPage();

    const actionGroup = screen.getByRole("group", { name: "Bookmark controls for Workspace shell" });
    const row = actionGroup.closest(".project-session-row-view");
    const openButton = row?.querySelector(".project-session-open-view") as HTMLButtonElement | null;

    expect(row).not.toBeNull();
    expect(openButton).toBeInstanceOf(HTMLButtonElement);
    expect(openButton).not.toContainElement(actionGroup);
    expect(row).toContainElement(openButton);
    expect(row).toContainElement(actionGroup);
  });

  it("keeps touch-sized controls and avoids nested interactive elements", () => {
    renderProjectPage();

    expect(screen.getByRole("main")).toHaveClass("project-page-view");
    expect(screen.getByRole("main").querySelector(".project-page-shell")).toBeInTheDocument();
    expect(screen.getByRole("main").querySelectorAll("button button, a a")).toHaveLength(0);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-label", `${project.name} sections`);
    for (const control of [
      screen.getByRole("link", { name: "Projects" }),
      screen.getByRole("tab", { name: "Previous Sessions" }),
      screen.getByRole("tab", { name: "Scheduled Jobs" }),
      screen.getByRole("tab", { name: "Settings" }),
    ]) {
      expect(control).toBeInTheDocument();
    }
  });
});
