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

  it("separates closed Projects and requires an explicit Open action", async () => {
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

    const closed = screen.getByRole("heading", { name: "Closed Projects" }).closest("section");
    if (closed === null) throw new Error("Closed Projects section is missing");
    expect(within(closed).getByRole("heading", { name: project.name })).toBeVisible();
    const viewAction = within(closed).getByRole("button", { name: `View ${project.name}` });
    await user.click(viewAction);
    expect(onOpen).toHaveBeenCalledWith(project.projectId);
    expect(onSetProjectClosed).not.toHaveBeenCalled();

    await user.click(within(closed).getByRole("button", { name: "Open Project" }));
    expect(onSetProjectClosed).toHaveBeenCalledWith(project.projectId, false);
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
