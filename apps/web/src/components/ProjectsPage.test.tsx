// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureState } from "../fixtures/workspace";
import { ProjectsPage } from "./ProjectsPage";

afterEach(cleanup);

const pageProps = {
  onAdd: vi.fn(),
  onNewSession: vi.fn(),
  onDashboard: vi.fn(),
  onProjects: vi.fn(),
  onSettings: vi.fn(),
  onReorderBookmark: vi.fn(),
};

describe("ProjectsPage", () => {
  it("orders recent work before older work and keeps Session creation separate from opening a Project", async () => {
    const user = userEvent.setup();
    const recent = fixtureState.projects[0]!;
    const other = fixtureState.projects[1]!;
    const source = fixtureState.sessions[0]!;
    const onNewSession = vi.fn();
    const onOpen = vi.fn();
    const state = { ...fixtureState, projectBookmarks: [], sessions: [
      { ...source, projectId: recent.projectId, lastActivityAt: "2026-09-05T10:00:00Z", name: "Latest task" },
      { ...source, projectId: other.projectId, lastActivityAt: "2026-08-01T10:00:00Z", name: "Older task" },
    ] };
    render(<ProjectsPage {...pageProps} state={state} onOpen={onOpen} onNewSession={onNewSession} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByRole("heading", { name: recent.name })).toBeVisible();
    expect(within(rows[0]!).getByText("Latest task")).toBeVisible();
    await user.click(within(rows[0]!).getByRole("button", { name: "New Session" }));
    expect(onNewSession).toHaveBeenCalledExactlyOnceWith(recent);
    expect(onOpen).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort Projects" }), "name");
    expect(screen.getAllByRole("listitem").map((row) => row.querySelector("h3")?.textContent)).toEqual([other.name, recent.name].sort());
    await user.click(screen.getByRole("button", { name: "Open directory" }));
    expect(onNewSession).toHaveBeenLastCalledWith();
  });
  it("does not show a header back button", () => {
    render(
      <ProjectsPage
        {...pageProps}
        state={fixtureState}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back to Workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Project" })).toBeInTheDocument();
  });

  it("lists Other Projects alphabetically", () => {
    render(
      <ProjectsPage
        {...pageProps}
        state={fixtureState}
        onOpen={vi.fn()}
      />,
    );

    const otherProjects = screen.getByRole("heading", { name: "Other Projects" })
      .closest("section");
    if (otherProjects === null) throw new Error("Other Projects section is missing");

    expect([...otherProjects.querySelectorAll("h3")].map((heading) => heading.textContent))
      .toEqual(["Field Notes", "Pi Station"]);
  });

  it("filters Projects by name or path", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage {...pageProps} state={fixtureState} onOpen={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Search Projects" }), "field-notes");

    expect(screen.getByRole("heading", { name: "Field Notes" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Pi Station" })).not.toBeInTheDocument();
  });

  it("keeps closed Projects in the main list and requires an explicit Open action", async () => {
    const user = userEvent.setup();
    const project = fixtureState.projects[0]!;
    const onOpen = vi.fn();
    const onSetProjectClosed = vi.fn(() => Promise.resolve());
    render(
      <ProjectsPage
        {...pageProps}
        state={{ ...fixtureState, projects: fixtureState.projects.map((item) => item.projectId === project.projectId ? { ...item, closed: true } : item) }}
        onOpen={onOpen}
        onSetProjectClosed={onSetProjectClosed}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Closed Projects" })).not.toBeInTheDocument();
    const projects = screen.getByRole("heading", { name: "Other Projects" }).closest("section");
    if (projects === null) throw new Error("Other Projects section is missing");
    expect(within(projects).getByRole("heading", { name: project.name })).toBeVisible();
    const viewAction = within(projects).getByRole("button", { name: `View ${project.name}` });
    await user.click(viewAction);
    expect(onOpen).toHaveBeenCalledWith(project.projectId);
    expect(onSetProjectClosed).not.toHaveBeenCalled();

    await user.click(within(projects).getByRole("button", { name: "Open Project" }));
    expect(onSetProjectClosed).toHaveBeenCalledWith(project.projectId, false);
  });

  it("keeps a closed bookmarked Project in the Bookmarked group", () => {
    const project = fixtureState.projects[0]!;
    render(
      <ProjectsPage
        {...pageProps}
        state={{
          ...fixtureState,
          projects: fixtureState.projects.map((item) => item.projectId === project.projectId ? { ...item, closed: true } : item),
          projectBookmarks: [{ projectId: project.projectId, position: 0 }],
        }}
        onOpen={vi.fn()}
      />,
    );

    const bookmarked = screen.getByRole("heading", { name: "Bookmarked" }).closest("section");
    if (bookmarked === null) throw new Error("Bookmarked section is missing");
    expect(within(bookmarked).getByRole("heading", { name: project.name })).toBeVisible();
    expect(within(bookmarked).getByRole("button", { name: "Open Project" })).toBeVisible();
  });

  it("opens a Project from its card area without a visible Open Project button", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const project = fixtureState.projects[0]!;

    render(
      <ProjectsPage
        {...pageProps}
        state={fixtureState}
        onOpen={onOpen}
      />,
    );

    expect(screen.queryByText("Open Project", { exact: true })).not.toBeInTheDocument();

    const openAction = screen.getByRole("button", { name: `Open ${project.name}` });
    expect(openAction).toHaveAccessibleName(`Open ${project.name}`);
    expect(openAction.querySelector("button")).toBeNull();

    await user.click(openAction);
    expect(onOpen).toHaveBeenCalledWith(project.projectId);
  });

  it("opens the card action with the keyboard and keeps Bookmark controls separate", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onReorderBookmark = vi.fn();
    const project = fixtureState.projects[0]!;
    const state = {
      ...fixtureState,
      projectBookmarks: fixtureState.projects.map((candidate, position) => ({
        projectId: candidate.projectId,
        position,
      })),
    };

    render(
      <ProjectsPage
        {...pageProps}
        state={state}
        onOpen={onOpen}
        onReorderBookmark={onReorderBookmark}
      />,
    );

    const openAction = screen.getByRole("button", { name: `Open ${project.name}` });
    openAction.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(project.projectId);

    expect(openAction.querySelector("button")).toBeNull();
    expect(screen.queryByText("Bookmark order")).not.toBeInTheDocument();

    const reorderControls = screen.getByRole("group", {
      name: `Change ${project.name} order`,
    });
    const moveDown = screen.getByRole("button", { name: `Move ${project.name} down` });
    expect(reorderControls).toContainElement(moveDown);

    await user.click(moveDown);
    expect(onReorderBookmark).toHaveBeenCalledWith(project.projectId, "down");
  });
});
