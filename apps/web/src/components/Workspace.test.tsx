// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  const localValues = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => localValues.set(key, value),
    removeItem: (key: string) => localValues.delete(key),
    clear: () => localValues.clear(),
  });
  const sessionValues = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => sessionValues.get(key) ?? null,
    setItem: (key: string, value: string) => sessionValues.set(key, value),
    removeItem: (key: string) => sessionValues.delete(key),
    clear: () => sessionValues.clear(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
import { Workspace } from "./Workspace";
import { sessionKeysEqual, type ApplicationState } from "../application/application-client-base";
import { fixtureState } from "../fixtures/workspace";

const enableDesktopViewport = (): void => {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === "(min-width: 1100px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", matchMedia);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
};

const enableMobileViewport = (): void => {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === "(max-width: 1099px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", matchMedia);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
};

const swipe = (
  target: Element,
  { startX = 12, startY = 120, endX = 124, endY = 124 } = {},
): void => {
  const point = (clientX: number, clientY: number) => ({ identifier: 1, clientX, clientY });
  const start = point(startX, startY);
  const end = point(endX, endY);
  fireEvent.touchStart(target, { touches: [start], targetTouches: [start], changedTouches: [start] });
  fireEvent.touchMove(target, { touches: [end], targetTouches: [end], changedTouches: [end] });
  fireEvent.touchEnd(target, { touches: [], targetTouches: [], changedTouches: [end] });
};

describe("Workspace", () => {
  it("opens Quick Session without selecting it or showing actions outside the modal", async () => {
    enableDesktopViewport();
    const onOpenQuickSession = vi.fn();
    const onSelect = vi.fn();
    render(<Workspace state={fixtureState} onSelect={onSelect} onOpenQuickSession={onOpenQuickSession} />);
    const trigger = screen.getByRole("button", { name: "Quick Session" });
    expect(trigger).toHaveAttribute("title", "Quick Session");
    expect(trigger).toHaveAttribute("aria-keyshortcuts", "Control+Shift+Space Meta+Shift+Space");
    expect(screen.queryByRole("button", { name: "Quick Session actions" })).not.toBeInTheDocument();
    await userEvent.click(trigger);
    expect(onOpenQuickSession).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: " ", code: "Space", ctrlKey: true, shiftKey: true });
    expect(onOpenQuickSession).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the default desktop sidebar and can collapse and expand it", async () => {
    enableDesktopViewport();
    const { container } = render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    expect(container.querySelector(".workspace")).toHaveStyle("--rail: 408px");
    await userEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByRole("complementary", { name: "Projects and Sessions" })).not.toBeInTheDocument();
    expect(container.querySelector(".workspace")).toHaveStyle("--rail: 0px");

    await userEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("complementary", { name: "Projects and Sessions" })).toBeVisible();
    expect(container.querySelector(".workspace")).toHaveStyle("--rail: 408px");
  });

  it("toggles the desktop sidebar with Control+B and rejects extra modifiers", () => {
    enableDesktopViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    const incompatible = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true, cancelable: true });
    fireEvent(window, incompatible);
    expect(incompatible.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeVisible();

    const toggle = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, cancelable: true });
    fireEvent(window, toggle);
    expect(toggle.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeVisible();
  });

  it("resizes the desktop sidebar within its limits with pointer and keyboard input", () => {
    enableDesktopViewport();
    const { container } = render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    const separator = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.pointerDown(separator, { button: 0, clientX: 408 });
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(container.querySelector(".workspace")).toHaveStyle("--rail: 500px");
    fireEvent.pointerMove(window, { clientX: 100 });
    expect(container.querySelector(".workspace")).toHaveStyle("--rail: 280px");
    fireEvent.pointerUp(window);

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "500");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "280");
  });

  it("does not add sidebar controls to the mobile layout", () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toHaveClass("sidebar-resize-handle");
    expect(screen.queryByRole("button", { name: "Show sidebar" })).not.toBeInTheDocument();
    const shortcut = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, cancelable: true });
    fireEvent(window, shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
  });

  it("shows a dedicated initial connection screen instead of a false Session", () => {
    render(
      <Workspace
        state={{
          ...fixtureState,
          connection: "connecting",
          sessions: [],
          selectedSessionKey: undefined,
        }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Pi Station" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting to Pi Station…");
    expect(screen.queryByRole("region", { name: "Selected Session" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message Pi" }))
      .not.toBeInTheDocument();
  });

  it("shows a control to jump to the latest activity after the user scrolls up", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const innerHeight = vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const scrollY = vi.spyOn(window, "scrollY", "get").mockReturnValue(200);
    const bodyHeight = vi.spyOn(document.body, "scrollHeight", "get").mockReturnValue(1800);
    const rootHeight = vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(1800);

    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    fireEvent.scroll(window);

    const jump = await screen.findByRole("button", { name: "Jump to latest" });
    await userEvent.click(jump);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1800, behavior: "auto" });
    expect(jump).not.toBeInTheDocument();

    innerHeight.mockRestore();
    scrollY.mockRestore();
    bodyHeight.mockRestore();
    rootHeight.mockRestore();
  });

  it("shows only unassigned open Sessions newest first in Other Sessions", () => {
    const source = fixtureState.sessions[0]!;
    const sessions = [
      { ...source, name: "Older other", projectId: "implicit-old", sessionKey: { hostId: "implicit-old", piSessionId: "old" }, lastActivityAt: "2026-01-01T00:00:00Z" },
      { ...source, name: "Closed other", projectId: "implicit-closed", sessionKey: { hostId: "implicit-closed", piSessionId: "closed" }, projection: { ...source.projection, availability: "closed" as const }, lastActivityAt: "2026-01-03T00:00:00Z" },
      { ...source, name: "Newest other", projectId: "implicit-new", sessionKey: { hostId: "implicit-new", piSessionId: "new" }, lastActivityAt: "2026-01-02T00:00:00Z" },
    ];
    render(<Workspace state={{ ...fixtureState, sessions }} onSelect={vi.fn()} />);
    const section = screen.getByText("Other Sessions").closest("section")!;
    expect(within(section).queryByText("Closed other")).not.toBeInTheDocument();
    expect([...section.querySelectorAll(".session-row-name")].map((name) => name.textContent)).toEqual(["Newest other", "Older other"]);
  });

  it("shows projectless Bookmarks separately from Other Sessions", () => {
    const source = fixtureState.sessions[0]!;
    const bookmarked = {
      ...source,
      name: "Saved research",
      projectId: "implicit-saved",
      sessionKey: { hostId: "implicit-saved", piSessionId: "saved" },
      projection: { ...source.projection, availability: "closed" as const },
    };
    const other = {
      ...source,
      name: "Temporary work",
      projectId: "implicit-other",
      sessionKey: { hostId: "implicit-other", piSessionId: "other" },
    };
    render(<Workspace state={{
      ...fixtureState,
      sessions: [bookmarked, other],
      sessionBookmarks: [{
        projectId: bookmarked.projectId,
        sessionKey: bookmarked.sessionKey,
        position: 0,
      }],
    }} onSelect={vi.fn()} />);

    const bookmarkedSection = screen.getByText("Bookmarked Sessions").closest("section")!;
    const otherSection = screen.getByText("Other Sessions").closest("section")!;
    expect(within(bookmarkedSection).getByText("Saved research")).toBeVisible();
    expect(within(bookmarkedSection).getByLabelText("Bookmarked")).toBeVisible();
    expect(within(bookmarkedSection).queryByText("Temporary work")).not.toBeInTheDocument();
    expect(within(otherSection).getByText("Temporary work")).toBeVisible();
    expect(within(otherSection).queryByText("Saved research")).not.toBeInTheDocument();
  });

  it("shows desktop navigation and focuses the composer after a Session change", async () => {
    enableDesktopViewport();
    const onSelect = vi.fn();
    const nextSession = fixtureState.sessions.find(({ sessionKey }) => (
      sessionKey.piSessionId === "session-client"
    ));
    if (nextSession === undefined) throw new Error("Session fixture is missing");
    const nextState: ApplicationState = {
      ...fixtureState,
      selectedSessionKey: nextSession.sessionKey,
      selected: {
        ...fixtureState.selected,
        sessionKey: nextSession.sessionKey,
        generationId: nextSession.generationId!,
      },
    };
    const { rerender } = render(<Workspace state={fixtureState} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Application client/ }));
    expect(onSelect).toHaveBeenCalledWith(nextSession.sessionKey);

    rerender(<Workspace state={nextState} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByLabelText("Message Pi")).toHaveFocus());
    expect(
      screen.getByRole("complementary", { name: /Projects and Sessions/ }),
    ).toBeVisible();
  });
  it("does not focus the composer after a Session change on mobile", async () => {
    enableMobileViewport();
    const onSelect = vi.fn();
    const nextSession = fixtureState.sessions.find(({ sessionKey }) => (
      sessionKey.piSessionId === "session-client"
    ));
    if (nextSession === undefined) throw new Error("Session fixture is missing");
    const nextState: ApplicationState = {
      ...fixtureState,
      selectedSessionKey: nextSession.sessionKey,
      selected: {
        ...fixtureState.selected,
        sessionKey: nextSession.sessionKey,
        generationId: nextSession.generationId!,
      },
    };
    const { rerender } = render(<Workspace state={fixtureState} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Application client/ }));

    rerender(<Workspace state={nextState} onSelect={onSelect} />);
    expect(screen.getByLabelText("Message Pi")).not.toHaveFocus();
  });

  it("uses one prioritized status indicator with accessible labels in project sidebar rows", () => {
    const bookmarked = fixtureState.sessions[0];
    const unbookmarked = fixtureState.sessions[1];
    const otherProject = fixtureState.projects.find((project) => (
      project.projectId !== unbookmarked?.projectId
    ));
    if (
      bookmarked === undefined
      || bookmarked.projectId === undefined
      || unbookmarked === undefined
      || otherProject === undefined
    ) {
      throw new Error("Session fixtures are missing");
    }
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessionBookmarks: [{
            projectId: bookmarked.projectId,
            sessionKey: bookmarked.sessionKey,
            position: 0,
          }, {
            projectId: otherProject.projectId,
            sessionKey: unbookmarked.sessionKey,
            position: 1,
          }],
        }}
        onSelect={vi.fn()}
      />,
    );

    const bookmarkedRow = screen.getByRole("button", { name: /Workspace shell/ });
    expect(bookmarkedRow).toHaveAttribute("aria-current", "page");
    expect(within(bookmarkedRow).getByLabelText("Working Session")).toBeVisible();
    expect(within(bookmarkedRow).getByRole("img", { name: "Bookmarked" }))
      .toHaveClass("session-bookmark-indicator");
    expect(bookmarkedRow).toHaveTextContent("Workspace shell");
    expect(within(bookmarkedRow).queryByLabelText("Unread Session")).not.toBeInTheDocument();

    const unbookmarkedRow = screen.getByRole("button", { name: /Application client/ });
    expect(within(unbookmarkedRow).queryByLabelText("Bookmarked")).not.toBeInTheDocument();
    expect(within(unbookmarkedRow).getByLabelText("Unread Session")).toBeVisible();
    for (const row of [bookmarkedRow, unbookmarkedRow]) {
      expect(row.querySelector(".session-row-name")).toBeInTheDocument();
      expect(row.querySelector(".session-row-accessory")).toBeInTheDocument();
      expect(row.querySelectorAll(".session-status-indicator")).toHaveLength(1);
      expect(row.querySelector(".session-row-unread-slot")).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "Dashboard" })).toHaveLength(1);
  });

  it("uses the unified status indicator in projectless and bookmarked sidebar rows", () => {
    const source = fixtureState.sessions[2];
    if (source === undefined) throw new Error("Session fixture is missing");
    const bookmarked = {
      ...source,
      sessionKey: { ...source.sessionKey, piSessionId: "projectless-bookmarked" },
      name: "Projectless bookmarked",
      projectId: "removed-project",
      projection: { ...source.projection, unread: { hasUnread: true } },
    };
    const { projectId: sourceProjectId, ...projectlessSource } = source;
    void sourceProjectId;
    const other = {
      ...projectlessSource,
      sessionKey: { ...source.sessionKey, piSessionId: "projectless-other" },
      name: "Projectless idle",
    };
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessions: [...fixtureState.sessions, bookmarked, other],
          sessionBookmarks: [{
            projectId: "removed-project",
            sessionKey: bookmarked.sessionKey,
            position: 0,
          }],
        }}
        onSelect={vi.fn()}
      />,
    );

    const bookmarkedRow = screen.getByRole("button", { name: /Projectless bookmarked/ });
    const otherRow = screen.getByRole("button", { name: /Projectless idle/ });
    expect(within(bookmarkedRow).getByLabelText("Unread Session")).toBeVisible();
    expect(within(otherRow).getByLabelText("Idle Session")).toBeVisible();
    for (const row of [bookmarkedRow, otherRow]) {
      expect(row.querySelectorAll(".session-status-indicator")).toHaveLength(1);
      expect(row.querySelector(".session-row-unread-slot")).not.toBeInTheDocument();
    }
  });

  it("keeps stable slots for long, delegated Session rows when state indicators change", () => {
    const parent = fixtureState.sessions[0];
    const child = fixtureState.sessions[1];
    if (parent === undefined || child === undefined || child.projectId === undefined) {
      throw new Error("Session fixtures are missing");
    }
    const longName = "A delegated Session name that is long enough to require truncation without moving indicators";
    const session = {
      ...child,
      name: longName,
      parentSessionKey: parent.sessionKey,
      projection: {
        ...child.projection,
        run: "working" as const,
        unread: { hasUnread: true },
      },
    };
    const { rerender } = render(
      <Workspace
        state={{
          ...fixtureState,
          sessions: [parent, session],
          selectedSessionKey: session.sessionKey,
          sessionBookmarks: [{ projectId: child.projectId, sessionKey: child.sessionKey, position: 0 }],
        }}
        onSelect={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: new RegExp(longName) });
    expect(row).toHaveAttribute("data-session-depth", "1");
    expect(row).toHaveAttribute("aria-current", "page");
    expect(within(row).getByLabelText("Working Session")).toBeVisible();
    expect(within(row).getByLabelText("Bookmarked")).toBeVisible();
    expect(within(row).queryByLabelText("Unread Session")).not.toBeInTheDocument();
    expect(row.querySelectorAll(".session-status-indicator")).toHaveLength(1);
    expect(row.querySelector(".session-row-name")).toHaveTextContent(longName);

    rerender(
      <Workspace
        state={{
          ...fixtureState,
          sessions: [parent, { ...session, projection: { ...session.projection, unread: { hasUnread: false } } }],
          selectedSessionKey: session.sessionKey,
          sessionBookmarks: [],
        }}
        onSelect={vi.fn()}
      />,
    );
    const changedRow = screen.getByRole("button", { name: new RegExp(longName) });
    expect(within(changedRow).queryByLabelText("Bookmarked")).not.toBeInTheDocument();
    expect(within(changedRow).queryByLabelText("Unread Session")).not.toBeInTheDocument();
    expect(within(changedRow).getByLabelText("Working Session")).toBeVisible();
    expect(changedRow.querySelector(".session-row-accessory")).toBeInTheDocument();
    expect(changedRow.querySelector(".session-row-unread-slot")).not.toBeInTheDocument();
  });

  it("keeps one Bookmark indicator on a delegated mobile sidebar row", () => {
    enableMobileViewport();
    const parent = fixtureState.sessions[0];
    const child = fixtureState.sessions[1];
    if (parent === undefined || child === undefined || child.projectId === undefined) {
      throw new Error("Session fixtures are missing");
    }
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessions: fixtureState.sessions.map((session) => (
            session === child
              ? {
                  ...session,
                  parentSessionKey: parent.sessionKey,
                  projection: {
                    ...session.projection,
                    run: "working" as const,
                    unread: { hasUnread: false },
                  },
                }
              : session
          )),
          sessionBookmarks: [{
            projectId: child.projectId,
            sessionKey: child.sessionKey,
            position: 0,
          }],
        }}
        onSelect={vi.fn()}
      />,
    );

    const childRow = screen.getByRole("button", { name: /Application client/ });
    expect(childRow).toHaveAttribute("data-session-depth", "1");
    expect(within(childRow).getByLabelText("Working Session")).toBeVisible();
    expect(within(childRow).queryByLabelText("Unread Session")).not.toBeInTheDocument();
    expect(childRow.querySelector(".session-row-accessory")).toBeInTheDocument();
    expect(childRow.querySelectorAll(".session-status-indicator")).toHaveLength(1);
    expect(childRow.querySelector(".session-row-unread-slot")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Bookmarked" })).toHaveLength(1);
  });

  it("opens Session actions from the sidebar context menu", async () => {
    const user = userEvent.setup();
    const source = fixtureState.sessions[1];
    if (source === undefined || source.projectId === undefined) {
      throw new Error("Session fixture is missing");
    }
    const session = {
      ...source,
      projection: {
        ...source.projection,
        run: "idle" as const,
        capabilities: [
          "session.rename",
          "session.clone",
          "session.reload",
          "session.close",
        ] as typeof source.projection.capabilities,
      },
    };
    const onCommand = vi.fn(() => "context-request");
    const onSetSessionBookmark = vi.fn(() => "bookmark-request");
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessions: fixtureState.sessions.map((candidate) => (
            candidate === source ? session : candidate
          )),
        }}
        onSelect={vi.fn()}
        onCommand={onCommand}
        onSetSessionBookmark={onSetSessionBookmark}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /Application client/ }), {
      clientX: 120,
      clientY: 80,
    });
    const menu = screen.getByRole("menu", { name: "Actions for Application client" });
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: "Bookmark" })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: "Clone Session" })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: "Reload Pi Session" })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: "Close" })).toBeEnabled();

    await user.click(within(menu).getByRole("menuitem", { name: "Clone Session" }));
    expect(onCommand).toHaveBeenCalledWith(
      { kind: "session.clone" },
      session.sessionKey,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /Application client/ }));
    await user.click(screen.getByRole("menuitem", { name: "Bookmark" }));
    expect(onSetSessionBookmark).toHaveBeenCalledWith(
      source.projectId,
      session.sessionKey,
      true,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /Application client/ }));
    await user.click(screen.getByRole("menuitem", { name: "Close" }));
    expect(screen.getByRole("alertdialog", { name: "Close Application client?" })).toBeVisible();
  });

  it("nests a delegated Session directly under its parent", async () => {
    const parent = fixtureState.sessions[0];
    const child = fixtureState.sessions[1];
    if (parent === undefined || child === undefined) {
      throw new Error("Session fixtures are missing");
    }
    const onSelect = vi.fn();
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessions: [
            child,
            parent,
            ...fixtureState.sessions.slice(2),
          ].map((session) => session.sessionKey.piSessionId === child.sessionKey.piSessionId
            ? {
                ...session,
                parentSessionKey: parent.sessionKey,
                projection: { ...session.projection, unread: { hasUnread: false } },
              }
            : session.sessionKey.piSessionId === parent.sessionKey.piSessionId
              ? { ...session, projection: { ...session.projection, unread: { hasUnread: true } } }
              : session),
        }}
        onSelect={onSelect}
      />,
    );

    const rows = [...document.querySelectorAll(".sidebar .session-row")];
    const parentRow = rows.find((row) => row.textContent?.includes("Workspace shell"));
    const childRow = rows.find((row) => row.textContent?.includes("Application client"));
    expect(parentRow).toHaveAttribute("data-session-depth", "0");
    expect(childRow).toHaveAttribute("data-session-depth", "1");
    expect(rows.indexOf(childRow!)).toBe(rows.indexOf(parentRow!) + 1);
    expect(within(parentRow as HTMLElement).getByLabelText("Working Session")).toBeVisible();
    expect(within(childRow as HTMLElement).getByLabelText("Idle Session")).toBeVisible();

    await userEvent.click(childRow as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(child.sessionKey);
  });

  it("hides an unbookmarked Project without an open Session", () => {
    const [runningProject, inactiveProject] = fixtureState.projects;
    if (runningProject === undefined || inactiveProject === undefined) {
      throw new Error("Project fixtures are missing");
    }
    render(
      <Workspace
        state={{
          ...fixtureState,
          projectBookmarks: [],
          sessions: fixtureState.sessions.filter(
            (session) => session.projectId !== inactiveProject.projectId,
          ),
        }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: runningProject.name })).toBeVisible();
    expect(screen.queryByRole("button", { name: inactiveProject.name }))
      .not.toBeInTheDocument();
  });

  it("defaults the Dashboard to Projects when no saved view exists", async () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  });

  it("restores the saved Dashboard Projects view", async () => {
    sessionStorage.setItem("pi-station:dashboard:view", "projects");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  });

  it("restores the saved Dashboard Open view", async () => {
    sessionStorage.setItem("pi-station:dashboard:view", "running");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tab", { name: "Open" })).toHaveAttribute("aria-selected", "true");
  });

  it("saves Dashboard view changes in session storage", async () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    await userEvent.click(screen.getByRole("tab", { name: "Open" }));
    expect(sessionStorage.getItem("pi-station:dashboard:view")).toBe("running");

    await userEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(sessionStorage.getItem("pi-station:dashboard:view")).toBe("projects");
  });

  it("uses Projects when the saved Dashboard view is invalid", async () => {
    sessionStorage.setItem("pi-station:dashboard:view", "closed");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses Projects when Dashboard session storage reads fail", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("Storage is disabled"); },
      setItem: vi.fn(),
    });
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  });

  it("changes Dashboard views when session storage writes fail", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("Storage is disabled"); },
    });
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    await userEvent.click(screen.getByRole("tab", { name: "Open" }));

    expect(screen.getByRole("tab", { name: "Open" })).toHaveAttribute("aria-selected", "true");
  });

  it("nests delegated Sessions on the Dashboard Projects and Open views", async () => {
    const user = userEvent.setup();
    const parent = fixtureState.sessions[0];
    if (parent === undefined) throw new Error("Session fixture is missing");
    const child = {
      ...parent,
      sessionKey: {
        ...parent.sessionKey,
        piSessionId: "delegated-child" as typeof parent.sessionKey.piSessionId,
      },
      parentSessionKey: parent.sessionKey,
      name: "Delegated audit",
    };
    render(
      <Workspace
        state={{ ...fixtureState, sessions: [...fixtureState.sessions, child] }}
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    const dashboard = screen.getByRole("heading", { name: "Dashboard" }).closest("main");
    if (dashboard === null) throw new Error("Dashboard is missing");
    expect(within(dashboard).getByRole("button", { name: /Delegated audit/ }))
      .toHaveAttribute("data-session-depth", "1");
    await user.click(within(dashboard).getByRole("tab", { name: "Open" }));
    const delegatedSession = within(dashboard).getByRole("button", { name: /Delegated audit/ });
    expect(delegatedSession).toHaveAttribute("data-session-depth", "1");
    expect(within(delegatedSession).queryByText("Pi Station")).not.toBeInTheDocument();
    expect(delegatedSession.querySelector(".dashboard-session-nesting")).toBeVisible();
  });

  it("shows the directory for a projectless Session in the Open view", async () => {
    const user = userEvent.setup();
    const session = fixtureState.sessions[0];
    if (session === undefined) throw new Error("Session fixture is missing");
    const projectless = {
      ...session,
      sessionKey: { ...session.sessionKey, piSessionId: "projectless-open" as typeof session.sessionKey.piSessionId },
      name: "Independent research",
      displayPath: "~/research/independent",
    };
    delete projectless.projectId;
    render(<Workspace state={{ ...fixtureState, sessions: [projectless] }} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    const dashboard = screen.getByRole("heading", { name: "Dashboard" }).closest("main");
    if (dashboard === null) throw new Error("Dashboard is missing");
    await user.click(within(dashboard).getByRole("tab", { name: "Open" }));
    const sessionButton = within(dashboard).getByRole("button", { name: /Independent research/ });
    expect(within(sessionButton).getByText("~/research/independent")).toBeVisible();
  });

  it("groups open Sessions by recent activity", async () => {
    const user = userEvent.setup();
    const session = fixtureState.sessions[0];
    if (session === undefined) throw new Error("Session fixture is missing");
    const now = new Date();
    const today = { ...session, name: "Today Session", lastActivityAt: now.toISOString() };
    const yesterday = {
      ...session,
      sessionKey: { ...session.sessionKey, piSessionId: "yesterday-session" as typeof session.sessionKey.piSessionId },
      name: "Yesterday Session",
      lastActivityAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString(),
    };
    const earlier = {
      ...session,
      sessionKey: { ...session.sessionKey, piSessionId: "earlier-session" as typeof session.sessionKey.piSessionId },
      name: "Earlier Session",
      lastActivityAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 12).toISOString(),
    };
    render(
      <Workspace
        state={{ ...fixtureState, sessions: [earlier, today, yesterday] }}
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    const dashboard = screen.getByRole("heading", { name: "Dashboard" }).closest("main");
    if (dashboard === null) throw new Error("Dashboard is missing");
    await user.click(within(dashboard).getByRole("tab", { name: "Open" }));

    expect(within(dashboard).getByRole("heading", { name: "Today" })).toBeVisible();
    expect(within(dashboard).getByRole("heading", { name: "Yesterday" })).toBeVisible();
    expect(within(dashboard).getByRole("heading", { name: "Earlier" })).toBeVisible();
  });

  it("shows an empty open state for an expanded bookmarked Project", () => {
    const project = fixtureState.projects[0];
    if (project === undefined) throw new Error("Project fixture is missing");
    render(
      <Workspace
        state={{
          ...fixtureState,
          projectBookmarks: [{ projectId: project.projectId, position: 0 }],
          sessions: fixtureState.sessions.filter(
            (session) => session.projectId !== project.projectId,
          ),
        }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText("No open Sessions").length).toBeGreaterThan(0);
  });

  it("opens a Project from its sidebar name", async () => {
    const user = userEvent.setup();
    const project = fixtureState.projects[0];
    if (project === undefined) throw new Error("Project fixture is missing");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: project.name }));
    expect(await screen.findByRole("heading", { name: project.name, level: 1 }))
      .toBeVisible();
  });

  it("keeps a reconnecting Session visible and does not offer Open Session", async () => {
    const user = userEvent.setup();
    const session = fixtureState.sessions[0];
    if (session === undefined) throw new Error("Session fixture is missing");
    const reconnecting = {
      ...session,
      projection: { ...session.projection, availability: "reconnecting" as const },
    };
    render(<Workspace
      state={{
        ...fixtureState,
        sessions: fixtureState.sessions.map((candidate) => (
          candidate.sessionKey === session.sessionKey ? reconnecting : candidate
        )),
      }}
      onSelect={vi.fn()}
    />);

    expect(screen.getByLabelText("Idle Session")).toBeInTheDocument();
    const project = fixtureState.projects.find(
      (candidate) => candidate.projectId === session.projectId,
    );
    if (project === undefined) throw new Error("Project fixture is missing");
    await user.click(screen.getByRole("button", { name: project.name }));
    expect(await screen.findByText("Reconnecting")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open Session" })).not.toBeInTheDocument();
  });

  it("configures one Development Server command and preview port from the Project", async () => {
    const user = userEvent.setup();
    const project = fixtureState.projects[0];
    if (project === undefined) throw new Error("Project fixture is missing");
    const onConfigure = vi.fn(() => "development-server-request");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onConfigureDevelopmentServer={onConfigure} />);
    await user.click(screen.getByRole("button", { name: project.name }));
    await user.click(within(screen.getByRole("tablist", { name: `${project.name} sections` })).getByRole("tab", { name: "Settings" }));
    await user.type(screen.getByLabelText(/^Command/), "npm run dev");
    await user.type(screen.getByLabelText(/Preview port/), "3104");
    await user.click(screen.getByRole("button", { name: "Save Development Server" }));
    expect(onConfigure).toHaveBeenCalledWith(project.projectId, { command: "npm run dev", previewPort: 3104 });
  });

  it("opens only the validated Development Server preview URL from Session controls", () => {
    const project = fixtureState.projects[0];
    if (project === undefined) throw new Error("Project fixture is missing");
    render(<Workspace state={{
      ...fixtureState,
      developmentServers: [{
        projectId: project.projectId,
        configuration: { command: "npm run dev", previewPort: 3104 },
        lifecycle: "running",
        previewUrl: "https://station.example.ts.net:3104/",
      }],
    }} onSelect={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Open preview" }))
      .toHaveAttribute("href", "https://station.example.ts.net:3104/");
  });

  it("reopens a closed Pi Session when its name is selected", async () => {
    const user = userEvent.setup();
    const project = fixtureState.projects[0];
    const source = fixtureState.sessions[0];
    if (project === undefined || source === undefined) throw new Error("Fixtures are missing");
    const closed = {
      ...source,
      projectId: project.projectId,
      name: "Saved Session",
      projection: {
        ...source.projection,
        availability: "closed" as const,
        synchronization: "not-applicable" as const,
        run: "unknown" as const,
        capabilities: [],
      },
    };
    const onSelect = vi.fn();
    const onCreateManagedSession = vi.fn(() => "resume-request");
    render(<Workspace
      state={{
        ...fixtureState,
        sessions: fixtureState.sessions.map((session) => (
          session === source ? closed : session
        )),
        sessionBookmarks: [{
          projectId: project.projectId,
          sessionKey: closed.sessionKey,
          position: 0,
        }],
      }}
      onSelect={onSelect}
      onCreateManagedSession={onCreateManagedSession}
    />);

    await user.click(screen.getByRole("button", { name: project.name }));
    expect(screen.queryByRole("button", { name: "Open Session" })).not.toBeInTheDocument();
    onSelect.mockClear();
    await user.click(screen.getByRole("button", { name: "Saved SessionClosed" }));
    expect(onCreateManagedSession).toHaveBeenCalledWith(
      project.displayPath,
      closed.name,
      closed.sessionKey,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the Projects index and separates Bookmarked Projects", async () => {
    const user = userEvent.setup();
    const bookmarkedProject = fixtureState.projects[0];
    if (bookmarkedProject === undefined) throw new Error("Project fixture is missing");
    const onSetProjectBookmark = vi.fn(() => "bookmark-request");
    render(
      <Workspace
        state={{
          ...fixtureState,
          projectBookmarks: [{
            projectId: bookmarkedProject.projectId,
            position: 1,
          }],
        }}
        onSelect={vi.fn()}
        onSetProjectBookmark={onSetProjectBookmark}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByRole("complementary", { name: "Projects and Sessions" }))
      .toBeVisible();
    expect(screen.getByRole("button", { name: "Projects" }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { current: "page", name: "Workspace shell" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects", level: 1 }))
      .toBeVisible();
    const bookmarkedSection = screen.getByRole("heading", { name: "Bookmarked" }).closest("section");
    const otherSection = screen.getByRole("heading", { name: "Other Projects" }).closest("section");
    if (bookmarkedSection === null || otherSection === null) throw new Error("Project sections are missing");
    expect(within(bookmarkedSection).getAllByRole("listitem")).toHaveLength(1);
    expect(within(otherSection).getAllByRole("listitem")).toHaveLength(
      fixtureState.projects.length - 1,
    );
    const bookmarkedCard = within(bookmarkedSection).getByRole("listitem");
    expect(bookmarkedCard).toHaveAttribute("data-slot", "card");
    expect(within(bookmarkedCard).getByText(bookmarkedProject.displayPath)).toBeVisible();
    const openProjectAction = within(bookmarkedCard).getByRole("button", {
      name: `Open ${bookmarkedProject.name}`,
    });
    expect(openProjectAction).toHaveAccessibleName(`Open ${bookmarkedProject.name}`);
    expect(openProjectAction).not.toHaveTextContent("Open Project");
    expect(within(bookmarkedCard).getByRole("button", {
      name: `Move ${bookmarkedProject.name} up`,
    })).toHaveAttribute("data-slot", "button");

    await user.click(screen.getByRole("button", {
      name: `Open ${bookmarkedProject.name}`,
    }));
    expect(screen.getByRole("heading", { name: bookmarkedProject.name, level: 1 }))
      .toBeVisible();
    expect(screen.getByRole("region", { name: "Sessions" })).toBeVisible();
    await user.click(within(screen.getByRole("tablist", { name: `${bookmarkedProject.name} sections` })).getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove Project Bookmark" }));
    expect(onSetProjectBookmark).toHaveBeenCalledWith(
      bookmarkedProject.projectId,
      false,
    );
    const projectNewSession = screen.getAllByRole("button", { name: "New Session" })
      .find((button) => button.textContent === "New Session");
    if (projectNewSession === undefined) throw new Error("Project action is missing");
    await user.click(projectNewSession);
    expect(screen.getByRole("dialog", { name: `New Session in ${bookmarkedProject.name}` }))
      .toBeVisible();
  });

  it("shows unavailable Projects as cards without disabling their open action", async () => {
    const user = userEvent.setup();
    const unavailable = fixtureState.projects[0];
    if (unavailable === undefined) throw new Error("Project fixture is missing");
    render(
      <Workspace
        state={{
          ...fixtureState,
          projects: fixtureState.projects.map((project) => (
            project.projectId === unavailable.projectId
              ? { ...project, available: false }
              : project
          )),
        }}
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Projects" }));
    const card = screen.getByRole("heading", { name: unavailable.name, level: 3 })
      .closest<HTMLElement>('[data-slot="card"]');
    if (card === null) throw new Error("Unavailable Project card is missing");
    expect(within(card).getByText("Unavailable")).toHaveAttribute("data-slot", "badge");
    expect(within(card).getByText("Unavailable")).toHaveAttribute("data-variant", "outline");
    expect(within(card).getByRole("button", { name: `Open ${unavailable.name}` }))
      .toBeEnabled();
  });

  it("shows the Projects empty state with an Add Project action", async () => {
    const user = userEvent.setup();
    render(
      <Workspace
        state={{ ...fixtureState, projects: [], sessions: [] }}
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Projects" }));
    const emptyState = screen.getByText("No Projects yet.").closest<HTMLElement>("div");
    if (emptyState === null) throw new Error("Projects empty state is missing");
    expect(within(emptyState).getByText("Add a Project to give Pi a working directory."))
      .toBeVisible();
    expect(within(emptyState).getByRole("button", { name: "Add Project" }))
      .toHaveAttribute("data-slot", "button");
  });

  it("opens Settings and its Notifications and Themes pages", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to Settings" }));

    await user.click(screen.getByRole("button", { name: /Themes/ }));
    expect(await screen.findByRole("heading", { name: "Themes", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(document.documentElement).toHaveAttribute("data-appearance", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme-id", "tri-palms");
  });

  it("reorders Bookmarked Projects with explicit controls", async () => {
    const user = userEvent.setup();
    const [first, second] = fixtureState.projects;
    if (first === undefined || second === undefined) {
      throw new Error("Project fixtures are missing");
    }
    const onReorderProjectBookmark = vi.fn(() => "reorder-request");
    render(
      <Workspace
        state={{
          ...fixtureState,
          projectBookmarks: [
            { projectId: first.projectId, position: 0 },
            { projectId: second.projectId, position: 1 },
          ],
        }}
        onSelect={vi.fn()}
        onReorderProjectBookmark={onReorderProjectBookmark}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Projects" }));
    await user.click(screen.getByRole("button", { name: `Move ${first.name} down` }));
    expect(onReorderProjectBookmark).toHaveBeenCalledWith(
      first.projectId,
      "down",
    );
    expect(screen.getByRole("button", { name: `Move ${first.name} up` }))
      .toBeDisabled();
  });

  it("opens the Add Project directory flow", async () => {
    const user = userEvent.setup();
    const onListDirectory = vi.fn(() => "directory-request");
    render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onListDirectory={onListDirectory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Projects" }));
    await user.click(screen.getByRole("button", { name: "Add Project" }));
    expect(await screen.findByRole("heading", { name: "Add Project" })).toBeVisible();
    expect(screen.getByLabelText("Project name")).toBeVisible();
    expect(onListDirectory).toHaveBeenCalledWith(undefined, false);
  });

  it("opens the general new Session page from the sidebar", async () => {
    const user = userEvent.setup();
    const onListDirectory = vi.fn(() => "directory-request");
    render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onListDirectory={onListDirectory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New Session" }));
    expect(screen.getByRole("heading", { name: "New Session" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Project" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "Directory" }));
    expect(onListDirectory).toHaveBeenCalledWith(undefined, false);
  });

  it("focuses the composer after a general Session starts on desktop", async () => {
    enableDesktopViewport();
    const user = userEvent.setup();
    const onCreateManagedSession = vi.fn(() => "create-request");
    const { rerender } = render(
      <Workspace
        state={{ ...fixtureState, managedSessionCreates: {} }}
        onSelect={vi.fn()}
        onCreateManagedSession={onCreateManagedSession}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New Session" }));
    await user.click(screen.getByRole("button", { name: "Start Pi" }));

    rerender(
      <Workspace
        state={{
          ...fixtureState,
          managedSessionCreates: {
            "create-request": {
              requestId: "create-request",
              status: "succeeded",
              result: { status: "succeeded", sessionKey: fixtureState.selectedSessionKey! },
            },
          },
        }}
        onSelect={vi.fn()}
        onCreateManagedSession={onCreateManagedSession}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Message Pi")).toHaveFocus());
  });

  it("opens the standard new Session modal from a Project", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", {
      name: "New Session in Pi Station",
    }));

    expect(screen.getByRole("dialog", {
      name: "New Session in Pi Station",
    })).toBeVisible();
    await waitFor(() => expect(
      screen.getByPlaceholderText("e.g. Release planning"),
    ).toHaveFocus());
    expect(screen.getByRole("button", { name: "Start Pi" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a Project Session without requiring a name", async () => {
    const user = userEvent.setup();
    const onCreateManagedSession = vi.fn(() => "create-request");
    render(
      <Workspace
        state={{
          ...fixtureState,
          hostCapabilities: ["managed-session.create"],
          managedSessionCreates: {},
        }}
        onSelect={vi.fn()}
        onCreateManagedSession={onCreateManagedSession}
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "New Session in Pi Station",
    }));
    const start = screen.getByRole("button", { name: "Start Pi" });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(onCreateManagedSession).toHaveBeenCalledWith(
      "~/workspace/pi-station",
      undefined,
    );
  });

  it("moves focus to the composer when Enter is pressed on the conversation page", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    document.body.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Message Pi")).toHaveFocus();
  });

  it("moves to adjacent Sessions with Ctrl+J and Ctrl+K on desktop", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(min-width: 1100px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const onSelect = vi.fn();
    render(<Workspace state={fixtureState} onSelect={onSelect} />);

    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ piSessionId: "session-notes" }),
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ piSessionId: "session-client" }),
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("selects numbered Sessions with Ctrl or Cmd on desktop", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(min-width: 1100px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onSelect = vi.fn();
    render(<Workspace state={fixtureState} onSelect={onSelect} />);

    fireEvent.keyDown(document, { key: "2", code: "Digit2", ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ piSessionId: "session-client" }),
    );

    fireEvent.keyDown(document, { key: "1", code: "Numpad1", metaKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ piSessionId: "session-notes" }),
    );
  });

  it("opens the existing close confirmation with Ctrl+Shift+W without closing directly", () => {
    const onCommand = vi.fn(() => "close-request");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={onCommand} />);
    const event = new KeyboardEvent("keydown", {
      key: "w",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(window, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("alertdialog", { name: "Close Workspace shell?" })).toBeVisible();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("opens the existing close confirmation with Meta+Shift+W", () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={vi.fn()} />);
    const event = new KeyboardEvent("keydown", {
      key: "W",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(window, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("alertdialog", { name: "Close Workspace shell?" })).toBeVisible();
  });

  it("ignores the close shortcut when an editable control has focus", () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={vi.fn()} />);
    const editableControls = [
      screen.getByLabelText("Message Pi"),
      Object.assign(document.createElement("input"), { type: "text" }),
      document.createElement("select"),
      Object.assign(document.createElement("div"), { contentEditable: "true" }),
    ];

    for (const control of editableControls) {
      if (control instanceof HTMLDivElement) control.setAttribute("contenteditable", "true");
      if (!control.isConnected) document.body.append(control);
      control.focus();
      const event = new KeyboardEvent("keydown", {
        key: "w",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(control, event);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      if (control !== editableControls[0]) control.remove();
    }
  });

  it("ignores the close shortcut outside an active Session page", async () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
    const event = new KeyboardEvent("keydown", {
      key: "w",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores the close shortcut while a Session overlay is open", async () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Session details" }));
    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preserves Ctrl+W browser behavior", () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={vi.fn()} />);
    const event = new KeyboardEvent("keydown", {
      key: "w",
      ctrlKey: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows numbered Session hints only while Ctrl or Cmd is held", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(min-width: 1100px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const sessionBookmarks = fixtureState.sessions.flatMap((session, position) => (
      session.projectId === undefined ? [] : [{
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        position,
      }]
    ));
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessionBookmarks,
        }}
        onSelect={vi.fn()}
      />,
    );
    const sidebar = screen.getByLabelText("Projects and Sessions");
    const firstSession = sidebar.querySelector<HTMLButtonElement>(".session-row");
    const firstSessionName = firstSession?.querySelector(".session-row-name")?.textContent;

    expect(sidebar).not.toHaveClass("shortcuts-visible");
    expect(firstSession).toHaveAttribute("data-session-shortcut", "1");
    expect(firstSession).toHaveAttribute("aria-keyshortcuts", "Control+1 Meta+1");

    const accessory = firstSession?.querySelector(".session-row-accessory");
    const bookmarkLayer = accessory?.querySelector(".session-row-accessory-content");
    const shortcutLayer = accessory?.querySelector(".session-row-shortcut");
    expect(accessory).toBeInTheDocument();
    expect(bookmarkLayer?.parentElement).toBe(accessory);
    expect(shortcutLayer?.parentElement).toBe(accessory);
    expect(shortcutLayer).toHaveAttribute("aria-hidden", "true");
    expect(within(firstSession as HTMLButtonElement).getByLabelText("Bookmarked")).toBeVisible();
    expect(firstSession?.querySelector(".session-status-indicator")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Control", ctrlKey: true });
    expect(sidebar).toHaveClass("shortcuts-visible");
    expect(bookmarkLayer).toHaveAttribute("aria-hidden", "true");
    expect(shortcutLayer).not.toHaveAttribute("aria-hidden");
    expect(within(firstSession as HTMLButtonElement).getByLabelText("Shortcut 1")).toBeInTheDocument();
    expect(firstSession?.querySelector(".session-row-name")).toHaveTextContent(firstSessionName ?? "");
    expect(firstSession?.querySelector(".session-status-indicator")).toBeInTheDocument();
    fireEvent.keyUp(document, { key: "Control" });
    expect(sidebar).not.toHaveClass("shortcuts-visible");
    expect(bookmarkLayer).not.toHaveAttribute("aria-hidden");
    expect(shortcutLayer).toHaveAttribute("aria-hidden", "true");
  });

  it("moves to the next unread Session with Ctrl+Shift+J on desktop", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(min-width: 1100px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onSelect = vi.fn();
    render(<Workspace state={fixtureState} onSelect={onSelect} />);

    fireEvent.keyDown(document, {
      key: "j",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ piSessionId: "session-client" }),
    );
  });

  it("reserves Session navigation shortcuts when no unread Session exists", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(min-width: 1100px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onSelect = vi.fn();
    render(
      <Workspace
        state={{
          ...fixtureState,
          sessions: fixtureState.sessions.map((session) => ({
            ...session,
            projection: {
              ...session.projection,
              unread: { hasUnread: false },
            },
          })),
        }}
        onSelect={onSelect}
      />,
    );
    const event = new KeyboardEvent("keydown", {
      key: "j",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("uses Dashboard as the mobile back destination", async () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Back to Dashboard" }),
    );
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  it("navigates to Dashboard after a deliberate mobile edge swipe", () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    swipe(screen.getByRole("region", { name: "Selected Session" }));

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  it("does not navigate when an edge swipe has insufficient distance", () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    swipe(screen.getByRole("region", { name: "Selected Session" }), { endX: 80 });

    expect(screen.getByRole("region", { name: "Selected Session" })).toBeVisible();
  });

  it("does not navigate for mostly vertical edge motion", () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    swipe(screen.getByRole("region", { name: "Selected Session" }), { endX: 62, endY: 240 });

    expect(screen.getByRole("region", { name: "Selected Session" })).toBeVisible();
  });

  it("does not navigate when a swipe starts away from the left edge", () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    swipe(screen.getByRole("region", { name: "Selected Session" }), { startX: 48, endX: 180 });

    expect(screen.getByRole("region", { name: "Selected Session" })).toBeVisible();
  });

  it("blocks edge swipes from controls and while an overlay is open", () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    swipe(screen.getByRole("button", { name: "Back to Dashboard" }));
    expect(screen.getByRole("region", { name: "Selected Session" })).toBeVisible();

    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    const palette = screen.getByRole("dialog");
    swipe(palette);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("region", { name: "Selected Session" })).toBeVisible();
  });

  it("orders the mobile Dashboard menu, title, and New Session control", async () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));

    const heading = screen.getByRole("heading", { name: "Dashboard" });
    const header = heading.closest("header");
    if (header === null) throw new Error("Dashboard header is missing");
    const menu = within(header).getByRole("button", { name: "Open navigation menu" });
    const newSession = header.querySelector<HTMLElement>(".dashboard-mobile-new-session");
    if (newSession === null) throw new Error("Mobile New Session control is missing");

    expect(menu.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(newSession) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newSession).toHaveAttribute("data-slot", "button");
    expect(newSession).toHaveAccessibleName("New Session");
    expect(newSession).toHaveAttribute("title", "New Session");
  });

  it("starts a new Session from the mobile Dashboard header", async () => {
    enableMobileViewport();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
    const header = screen.getByRole("heading", { name: "Dashboard" }).closest("header");
    const newSession = header?.querySelector<HTMLElement>(".dashboard-mobile-new-session");
    if (newSession === null || newSession === undefined) throw new Error("Mobile New Session control is missing");

    await userEvent.click(newSession);

    expect(screen.getByRole("heading", { name: "New Session" })).toBeVisible();
  });

  it("navigates from the mobile menu on Dashboard and Projects", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Back to Dashboard" }));
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("menuitem", { name: "Dashboard" }))
      .toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("menuitem", { name: "Projects" }));
    expect(screen.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("menuitem", { name: "Projects" }))
      .toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });

  it("opens and closes the mobile Session settings menu without removing the app", async () => {
    enableMobileViewport();
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Session and delivery settings" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toBeVisible();
    expect(within(menu).getByText(/Model ·/)).toBeVisible();
    expect(within(menu).getByText(/Thinking ·/)).toBeVisible();
    expect(screen.getByRole("region", { name: "Selected Session" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Session and delivery settings" })).toHaveFocus();
  });

  it("keeps the transparent transcription control separate from the Send and open-voice control", () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    const transcription = screen.getByRole("button", { name: "Record message" });
    const openVoice = screen.getByRole("button", { name: "Open voice mode" });
    expect(transcription).toHaveAttribute("data-slot", "button");
    expect(transcription).toHaveClass("composer-transcription-button");
    expect(transcription).toHaveAttribute("data-state", "idle");
    expect(openVoice).not.toHaveClass("composer-transcription-button");
  });

  it("enables the composer for a supported synchronized Session", () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Message Pi")).toBeEnabled();
    const model = screen.getByRole("combobox", { name: "Model: GPT-5.6 Sol" });
    const thinking = screen.getByRole("combobox", { name: "Thinking level: medium" });
    expect(model).toHaveTextContent("GPT-5.6 Sol");
    expect(thinking).toHaveTextContent("Thinking: Medium");
    expect(model.querySelectorAll("svg")).toHaveLength(1);
    expect(thinking.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open voice mode" })).toBeDisabled();
    expect(screen.queryByText(/follow the current run/)).not.toBeInTheDocument();
  });

  it("keeps on-screen Voice Mode available without Media Session handlers", async () => {
    localStorage.setItem("pi-station:composer-mode", "voice");
    const setActionHandler = vi.fn();
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: { setActionHandler } });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ settings: {
      openAiKeyConfigured: true,
      maxRecordingSeconds: 60,
      speechModel: "gpt-4o-mini-tts",
      speechSpeed: 1,
      speechVoice: "alloy",
      voiceAutoplay: true,
    } }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    const voiceModeRecord = await screen.findByRole("button", { name: "Start recording" });
    expect(voiceModeRecord).toBeEnabled();
    expect(voiceModeRecord).toHaveClass("voice-mode-record");
    expect(voiceModeRecord).not.toHaveClass("composer-transcription-button");
    expect(screen.getByRole("switch", { name: "Auto-play on" })).toBeEnabled();
    expect(setActionHandler).not.toHaveBeenCalled();
  });
  it("closes the agent menu after a mention is selected", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    const composer = screen.getByLabelText("Message Pi");
    await user.type(composer, "Ask @");
    await user.click(screen.getByRole("option", { name: "Application client" }));

    expect(composer).toHaveValue("Ask @Pi Station: Application client ");
    expect(screen.queryByRole("listbox", { name: "Open Sessions" })).not.toBeInTheDocument();
    await user.type(composer, "for an update");
    expect(composer).toHaveValue("Ask @Pi Station: Application client for an update");
    expect(screen.queryByRole("listbox", { name: "Open Sessions" })).not.toBeInTheDocument();
  });

  it("keeps each composer draft with its Session", async () => {
    const user = userEvent.setup();
    const secondSession = fixtureState.sessions[1];
    if (secondSession === undefined) throw new Error("Second Session fixture is missing");
    const secondState: ApplicationState = {
      ...fixtureState,
      selectedSessionKey: secondSession.sessionKey,
      selected: {
        ...fixtureState.selected,
        sessionKey: secondSession.sessionKey,
        generationId: secondSession.generationId!,
        projection: fixtureState.selected.projection!,
      },
    };
    const { rerender } = render(<Workspace state={fixtureState} onSelect={vi.fn()} />);

    await user.type(screen.getByLabelText("Message Pi"), "Workspace draft");
    rerender(<Workspace state={secondState} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Message Pi")).toHaveValue(""));
    await user.type(screen.getByLabelText("Message Pi"), "Client draft");

    rerender(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Message Pi")).toHaveValue("Workspace draft"));
    rerender(<Workspace state={secondState} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Message Pi")).toHaveValue("Client draft"));
  });

  it("inserts a newline with Enter and submits with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "request-shortcut");
    render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onCommand={onCommand}
      />,
    );
    const composer = screen.getByLabelText("Message Pi");
    await user.type(composer, "First{Enter}Second");
    expect(composer).toHaveValue("First\nSecond");
    expect(onCommand).not.toHaveBeenCalled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onCommand).toHaveBeenCalledWith({
      kind: "prompt.steer",
      text: "First\nSecond",
    });
  });

  it("uploads an image through the client adapter and submits its upload ID", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const onUploadImage = vi.fn(() => Promise.resolve("upload-image-1"));
    const onCommand = vi.fn(() => "request-image");
    const { container } = render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onCommand={onCommand}
        onUploadImage={onUploadImage}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("Image input is missing");
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screen.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Ready")).toBeVisible());
    expect(onUploadImage).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onCommand).toHaveBeenCalledWith({
      kind: "prompt.steer",
      text: "",
      imageIds: ["upload-image-1"],
    });
  });

  it("shows the useful error returned by the image upload adapter", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    const { container } = render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onUploadImage={() => Promise.reject(new Error("Image is larger than 10 MB."))}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("Image input is missing");
    fireEvent.change(input, { target: { files: [new File(["image"], "screen.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Image is larger than 10 MB.");
    expect(screen.getByText("Failed")).toBeVisible();
  });

  it("keeps an optimistic message until the matching Timeline message arrives", async () => {
    const user = userEvent.setup();
    const requestId = "01900000-0000-7000-8000-000000000099";
    const projection = fixtureState.selected.projection;
    if (projection === undefined) throw new Error("Selected Session projection is missing");
    const idleState: ApplicationState = {
      ...fixtureState,
      selected: {
        ...fixtureState.selected,
        projection: { ...projection, run: "idle" },
      },
    };
    const onCommand = vi.fn(() => requestId);
    const { rerender } = render(
      <Workspace state={idleState} onSelect={vi.fn()} onCommand={onCommand} />,
    );
    await user.type(screen.getByLabelText("Message Pi"), "Keep this visible");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(conversation).toHaveTextContent("Keep this visible");

    const completedState: ApplicationState = {
      ...idleState,
      commands: {
        [requestId]: {
          requestId,
          status: "completed",
          result: {
            requestId,
            outcome: { status: "succeeded", effect: { kind: "prompt-committed" } },
          },
        },
      },
    };
    rerender(<Workspace state={completedState} onSelect={vi.fn()} onCommand={onCommand} />);
    expect(conversation).toHaveTextContent("Keep this visible");

    const existingUserMessage = completedState.selected.timeline.find(
      (item) => item.category === "user-message",
    );
    if (existingUserMessage === undefined) throw new Error("User message fixture is missing");
    rerender(<Workspace
      state={{
        ...completedState,
        selected: {
          ...completedState.selected,
          timeline: completedState.selected.timeline.map((item) => (
            item === existingUserMessage
              ? { ...existingUserMessage, content: { text: "Keep this visible" } }
              : item
          )),
        },
      }}
      onSelect={vi.fn()}
      onCommand={onCommand}
    />);
    expect(within(conversation).getAllByText("Keep this visible")).toHaveLength(1);
  });

  it("keeps a local thinking placeholder until real agent activity arrives", async () => {
    const user = userEvent.setup();
    const projection = fixtureState.selected.projection;
    if (projection === undefined) throw new Error("Selected Session projection is missing");
    const assistant = fixtureState.selected.timeline.find(
      (item) => item.category === "assistant-response",
    );
    if (assistant === undefined) throw new Error("Assistant response fixture is missing");
    const idleState: ApplicationState = {
      ...fixtureState,
      selected: {
        ...fixtureState.selected,
        projection: { ...projection, run: "idle" },
        timeline: fixtureState.selected.timeline.filter((item) => item !== assistant),
      },
    };
    const onCommand = vi.fn(() => "request-thinking");
    const { rerender } = render(
      <Workspace state={idleState} onSelect={vi.fn()} onCommand={onCommand} />,
    );
    await user.type(screen.getByLabelText("Message Pi"), "Start a response");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const workingState: ApplicationState = {
      ...idleState,
      selected: {
        ...idleState.selected,
        projection: { ...projection, run: "working" },
      },
    };
    rerender(<Workspace state={workingState} onSelect={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByRole("status", { name: "Pi is thinking" })).toBeVisible();

    rerender(<Workspace
      state={{
        ...workingState,
        selected: {
          ...workingState.selected,
          timeline: [...workingState.selected.timeline, assistant],
        },
      }}
      onSelect={vi.fn()}
      onCommand={onCommand}
    />);
    expect(screen.queryByRole("status", { name: "Pi is thinking" })).not.toBeInTheDocument();
  });

  it("keeps submitted follow-ups out of the conversation until Pi processes them", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "request-follow-up");
    render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onCommand={onCommand}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Message delivery" }));
    await user.click(screen.getByRole("option", { name: "Follow up" }));
    await user.type(screen.getByLabelText("Message Pi"), "Review this next");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(onCommand).toHaveBeenCalledWith({
      kind: "prompt.follow-up",
      text: "Review this next",
    });
    expect(screen.getByRole("complementary", { name: "Pending Session input" }))
      .toHaveTextContent("Sending");
    expect(screen.getByRole("region", { name: "Conversation" }))
      .not.toHaveTextContent("Review this next");
  });
  it("opens the command palette, scrolls the active option, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Session details" });
    trigger.focus();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    const query = screen.getByPlaceholderText("Choose an action…");
    expect(query).toHaveFocus();
    scrollIntoView.mockClear();
    await user.keyboard("{ArrowDown}");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  it("handles an empty command palette query without invalid navigation", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    const query = screen.getByPlaceholderText("Choose an action…");
    await user.type(query, "no such action");
    expect(screen.getByText("No actions match that search.")).toBeVisible();
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("runs palette setting subflows with authoritative choices", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "request-setting");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={onCommand} />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    await user.click(screen.getByRole("option", { name: /Rename Session/ }));
    const input = screen.getByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "Palette name");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onCommand).toHaveBeenCalledWith({ kind: "session.rename", name: "Palette name" });

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("option", { name: /Change model/ }));
    expect(screen.getByRole("option", { name: /Claude Sonnet 4.5/ })).toBeVisible();
    await user.click(screen.getByRole("option", { name: /Claude Sonnet 4.5/ }));
    expect(onCommand).toHaveBeenCalledWith({ kind: "session.model.set", provider: "anthropic", modelId: "claude-sonnet-4-5" });

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("option", { name: /Change thinking level/ }));
    expect(screen.queryByRole("option", { name: "Max" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "High" }));
    expect(onCommand).toHaveBeenCalledWith({ kind: "session.thinking.set", level: "high" });
  });

  it("runs Abort and close confirmation from the palette", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "request-direct");
    render(<Workspace state={fixtureState} onSelect={vi.fn()} onCommand={onCommand} />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    await user.click(screen.getByRole("option", { name: /^Abort$/ }));
    expect(onCommand).toHaveBeenCalledWith({ kind: "session.abort" });
    expect(screen.queryByRole("dialog", { name: "Session actions" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    await user.click(screen.getByRole("option", { name: /Close Session/ }));
    expect(screen.getByRole("dialog", { name: "Close Workspace shell?" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Keep Session open" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Stop work and close Session" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Session actions" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: /Close Session/ }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onCommand).toHaveBeenCalledWith({ kind: "session.close" });
  });

  it("uses safe fallback text when the closing Session has no name", async () => {
    const user = userEvent.setup();
    const selected = {
      ...fixtureState.selected,
      details: { ...fixtureState.selected.details!, name: undefined },
    };
    const sessions = fixtureState.sessions.map((session) => (
      session.sessionKey.piSessionId === fixtureState.selectedSessionKey?.piSessionId
        ? { ...session, name: undefined }
        : session
    ));
    render(<Workspace
      state={{ ...fixtureState, selected, sessions }}
      onSelect={vi.fn()}
      onCommand={vi.fn(() => "close-request")}
    />);

    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    await user.click(screen.getByRole("option", { name: /Close Session/ }));

    expect(screen.getByRole("dialog", { name: "Close this Session?" })).toBeVisible();
  });

  it("keeps the parent selected while a delegated child is indexed, reconnects, and completes", () => {
    const onSelect = vi.fn();
    const parent = fixtureState.sessions.find((session) => (
      sessionKeysEqual(session.sessionKey, fixtureState.selectedSessionKey!)
    ))!;
    const child = {
      ...fixtureState.sessions.find((session) => (
        !sessionKeysEqual(session.sessionKey, parent.sessionKey)
      ))!,
      parentSessionKey: parent.sessionKey,
      projection: {
        ...fixtureState.sessions[0]!.projection,
        availability: "available" as const,
        run: "working" as const,
      },
    };
    const parentSelected = {
      ...fixtureState,
      selectedSessionKey: parent.sessionKey,
      sessions: [parent],
    };
    const { rerender } = render(<Workspace state={parentSelected} onSelect={onSelect} />);

    rerender(<Workspace
      state={{ ...parentSelected, sessions: [child] }}
      onSelect={onSelect}
    />);
    rerender(<Workspace
      state={{ ...parentSelected, sessions: [child, parent] }}
      onSelect={onSelect}
    />);
    rerender(<Workspace
      state={{
        ...parentSelected,
        sessions: [{
          ...child,
          projection: { ...child.projection, run: "idle" as const },
        }, parent],
      }}
      onSelect={onSelect}
    />);

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/Build the first Workspace shell/u)).toBeVisible();
  });

  it("leaves a retained closed Session feed for the previously viewed Open Session", () => {
    const onSelect = vi.fn();
    const previous = fixtureState.sessions.find((session) => (
      session.sessionKey.piSessionId === "session-client"
    ))!;
    const current = fixtureState.selectedSessionKey!;
    const { rerender } = render(
      <Workspace state={{ ...fixtureState, selectedSessionKey: previous.sessionKey }} onSelect={onSelect} />,
    );
    rerender(<Workspace state={fixtureState} onSelect={onSelect} />);
    rerender(<Workspace
      state={{
        ...fixtureState,
        sessions: fixtureState.sessions.map((session) => (
          sessionKeysEqual(session.sessionKey, current)
            ? { ...session, projection: { ...session.projection, availability: "closed" as const } }
            : session
        )),
      }}
      onSelect={onSelect}
    />);

    expect(onSelect).toHaveBeenLastCalledWith(previous.sessionKey);
  });

  it("prefers the Open parent when the selected delegated child closes", () => {
    const onSelect = vi.fn();
    const parent = fixtureState.sessions.find((session) => (
      session.sessionKey.piSessionId === "session-client"
    ))!;
    const child = fixtureState.sessions.find((session) => (
      sessionKeysEqual(session.sessionKey, fixtureState.selectedSessionKey!)
    ))!;
    const delegatedState = {
      ...fixtureState,
      sessions: fixtureState.sessions.map((session) => (
        sessionKeysEqual(session.sessionKey, child.sessionKey)
          ? { ...session, parentSessionKey: parent.sessionKey }
          : session
      )),
    };
    const { rerender } = render(<Workspace state={delegatedState} onSelect={onSelect} />);
    rerender(<Workspace
      state={{
        ...delegatedState,
        sessions: delegatedState.sessions.map((session) => (
          sessionKeysEqual(session.sessionKey, child.sessionKey)
            ? { ...session, projection: { ...session.projection, availability: "closed" as const } }
            : session
        )),
      }}
      onSelect={onSelect}
    />);

    expect(onSelect).toHaveBeenLastCalledWith(parent.sessionKey);
  });

  it("does not navigate when a non-selected Session closes", () => {
    const onSelect = vi.fn();
    const other = fixtureState.sessions.find((session) => (
      !sessionKeysEqual(session.sessionKey, fixtureState.selectedSessionKey!)
    ))!;
    const { rerender } = render(<Workspace state={fixtureState} onSelect={onSelect} />);
    rerender(<Workspace
      state={{
        ...fixtureState,
        sessions: fixtureState.sessions.map((session) => (
          sessionKeysEqual(session.sessionKey, other.sessionKey)
            ? { ...session, projection: { ...session.projection, availability: "closed" as const } }
            : session
        )),
      }}
      onSelect={onSelect}
    />);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("gates unsupported palette actions and navigates to Projects", async () => {
    const user = userEvent.setup();
    const state = {
      ...fixtureState,
      selected: {
        ...fixtureState.selected,
        projection: {
          ...fixtureState.selected.projection!,
          run: "idle" as const,
          capabilities: [],
        },
      },
    };
    render(<Workspace state={state} onSelect={vi.fn()} />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("option", { name: /Rename Session/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Close Session/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Abort$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /^Projects$/ }));
    expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  it("clones an idle Session from Session details", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "clone-request");
    const state = {
      ...fixtureState,
      selected: {
        ...fixtureState.selected,
        projection: {
          ...fixtureState.selected.projection!,
          run: "idle" as const,
          capabilities: [...fixtureState.selected.projection!.capabilities, "session.clone"] as NonNullable<typeof fixtureState.selected.projection>["capabilities"],
        },
      },
      sessions: fixtureState.sessions.map((session) => (
        sessionKeysEqual(session.sessionKey, fixtureState.selectedSessionKey!)
          ? {
              ...session,
              projection: {
                ...session.projection,
                run: "idle" as const,
                capabilities: [...session.projection.capabilities, "session.clone"] as typeof session.projection.capabilities,
              },
            }
          : session
      )),
    };
    const onCreateManagedSession = vi.fn(() => "resume-clone-request");
    const { rerender } = render(<Workspace state={state} onSelect={vi.fn()} onCommand={onCommand} onCreateManagedSession={onCreateManagedSession} />);

    await user.click(screen.getByRole("button", { name: "Session details" }));
    await user.click(await screen.findByRole("button", { name: "Clone Session" }));

    expect(onCommand).toHaveBeenCalledWith({ kind: "session.clone" });
    rerender(<Workspace
      state={{
        ...state,
        commands: {
          "clone-request": {
            requestId: "clone-request",
            status: "completed",
            result: {
              requestId: "clone-request",
              outcome: {
                status: "succeeded",
                effect: { kind: "clone-created", piSessionId: "01900000-0000-7000-8000-000000000099" },
              },
            },
          },
        } as unknown as ApplicationState["commands"],
      }}
      onSelect={vi.fn()}
      onCommand={onCommand}
      onCreateManagedSession={onCreateManagedSession}
    />);

    expect(onCreateManagedSession).toHaveBeenCalledWith(
      "~/workspace/pi-station",
      "Workspace shell-clone",
      {
        hostId: fixtureState.selectedSessionKey!.hostId,
        piSessionId: "01900000-0000-7000-8000-000000000099",
      },
    );
  });

  it("reloads an idle Pi Session from Session details", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "reload-request");
    const state = {
      ...fixtureState,
      selected: {
        ...fixtureState.selected,
        projection: {
          ...fixtureState.selected.projection!,
          run: "idle" as const,
        },
      },
    };
    render(<Workspace state={state} onSelect={vi.fn()} onCommand={onCommand} />);

    await user.click(screen.getByRole("button", { name: "Session details" }));
    await user.click(screen.getByRole("button", { name: "Reload Pi Session" }));

    expect(onCommand).toHaveBeenCalledWith({ kind: "session.reload" });
  });

  it("uses a modal to restart an idle managed Session and shows progress and success", async () => {
    const user = userEvent.setup();
    const onRestartManagedSession = vi.fn(() => "restart-request");
    const state = { ...fixtureState, selected: { ...fixtureState.selected, projection: {
      ...fixtureState.selected.projection!, run: "idle" as const,
      management: { kind: "managed" as const, managedSessionId: "01900000-0000-7000-8000-000000000001", runner: "tmux:pi-station" as const, processState: "running" as const },
    } } };
    const view = render(<Workspace state={state} onSelect={vi.fn()} onRestartManagedSession={onRestartManagedSession} />);
    await user.click(screen.getByRole("button", { name: "Session details" }));
    await user.click(screen.getByRole("button", { name: "Restart Session" }));

    const dialog = screen.getByRole("dialog", { name: "Restart Session?" });
    expect(onRestartManagedSession).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Restart Session" }));
    expect(onRestartManagedSession).toHaveBeenCalledWith(state.selectedSessionKey, state.selected.generationId);

    view.rerender(<Workspace state={{ ...state, managedSessionRestarts: {
      "restart-request": { requestId: "restart-request", status: "restarting" },
    } }} onSelect={vi.fn()} onRestartManagedSession={onRestartManagedSession} />);
    expect(screen.getByRole("status")).toHaveTextContent("Restarting Session…");

    view.rerender(<Workspace state={{ ...state, managedSessionRestarts: {
      "restart-request": { requestId: "restart-request", status: "succeeded", result: { status: "succeeded", sessionKey: state.selectedSessionKey!, generationId: state.selected.generationId! } },
    } }} onSelect={vi.fn()} onRestartManagedSession={onRestartManagedSession} />);
    const successDialog = screen.getByRole("dialog", { name: "Session restarted" });
    expect(within(successDialog).getByRole("status")).toHaveTextContent("The Session restarted successfully.");
    expect(within(successDialog).queryByText("The current Pi process will stop.", { exact: false })).not.toBeInTheDocument();
  });

  it("shows outcome-unknown feedback when a managed Session restart cannot be confirmed", async () => {
    const user = userEvent.setup();
    const state = { ...fixtureState, selected: { ...fixtureState.selected, projection: {
      ...fixtureState.selected.projection!, run: "idle" as const,
      management: { kind: "managed" as const, managedSessionId: "01900000-0000-7000-8000-000000000001", runner: "tmux:pi-station" as const, processState: "running" as const },
    } } };
    const view = render(<Workspace state={state} onSelect={vi.fn()} onRestartManagedSession={() => "unknown-request"} />);
    await user.click(screen.getByRole("button", { name: "Session details" }));
    await user.click(screen.getByRole("button", { name: "Restart Session" }));
    const dialog = screen.getByRole("dialog", { name: "Restart Session?" });
    await user.click(within(dialog).getByRole("button", { name: "Restart Session" }));
    view.rerender(<Workspace state={{ ...state, managedSessionRestarts: {
      "unknown-request": { requestId: "unknown-request", status: "outcome-unknown", result: { status: "outcome-unknown", error: {
          requestId: "01900000-0000-7000-8000-000000000099",
          code: "outcome-unknown", message: "Managed Session did not reconnect.", retryable: false,
        } } },
    } }} onSelect={vi.fn()} onRestartManagedSession={() => "unknown-request"} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Restart outcome is unknown. Managed Session did not reconnect.");
  });

  it("opens Session details and confirms closing the Session", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(() => "close-request");
    render(
      <Workspace
        state={fixtureState}
        onSelect={vi.fn()}
        onCommand={onCommand}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Session details" }));
    expect(screen.getByRole("dialog", { name: "Workspace shell" }))
      .toBeVisible();
    expect(screen.getByText("Session ID")).toBeVisible();
    expect(screen.getByText("Project").parentElement?.nextElementSibling).toBe(screen.getByText("Updated").parentElement);
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    const projectFact = screen.getByText("Project").parentElement;
    expect(projectFact).not.toBeNull();
    expect(within(projectFact!).getByRole("button", { name: fixtureState.projects[0]!.name })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open Project" })).not.toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const copyButton = screen.getByRole("button", { name: "Copy Session ID" });
    expect(copyButton.closest("dd")).toHaveTextContent(fixtureState.selectedSessionKey!.piSessionId);
    await user.click(copyButton);
    expect(writeText).toHaveBeenCalledWith(fixtureState.selectedSessionKey!.piSessionId);
    expect(await screen.findByRole("button", { name: "Session ID copied" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const nameInput = screen.getByLabelText("Session name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Session");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onCommand).toHaveBeenCalledWith({
      kind: "session.rename",
      name: "Renamed Session",
    });

    expect(screen.queryByRole("button", { name: "Change model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change thinking level" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Session" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Close Workspace shell?" });
    await user.click(within(confirmation).getByRole("button", { name: "Close Session" }));
    expect(onCommand).toHaveBeenCalledWith({ kind: "session.close" });
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close Session details" }));
    expect(screen.queryByRole("dialog", { name: "Workspace shell" }))
      .not.toBeInTheDocument();
  });

  it("renders Session details above a subtle non-blurred overlay with a shadcn trigger", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Session details" });
    expect(trigger).toHaveClass("session-details-trigger", "size-10", "rounded-md", "border-border");
    expect(trigger).not.toHaveClass("more", "rounded-full", "border-transparent");
    await user.click(trigger);
    const content = screen.getByRole("dialog", { name: "Workspace shell" });
    const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
    expect(content).toHaveClass("z-[60]", "fixed", "bg-background", "data-[side=right]:w-full");
    expect(content).not.toHaveClass("session-details", "data-[side=right]:w-3/4");
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("z-50", "fixed", "bg-black/5");
    expect(overlay?.className).not.toMatch(/backdrop|blur/);
    await user.click(overlay!);
    expect(screen.queryByRole("dialog", { name: "Workspace shell" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes Session details with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Session details" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Workspace shell" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Environment/ })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: /Environment/ }));
    expect(screen.getByRole("button", { name: /Environment/ })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Workspace shell" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("preserves transcript whitespace and native tool disclosure", () => {
    render(<Workspace state={fixtureState} onSelect={vi.fn()} />);
    expect(
      screen.getByText(/Build the first Workspace shell/).textContent,
    ).toContain("shell.\nPreserve");
    expect(
      screen.getByText(/Used read/).closest("details"),
    ).toBeInTheDocument();
  });
  it("uses approved product terms", () => {
    const { container } = render(
      <Workspace state={fixtureState} onSelect={vi.fn()} />,
    );
    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).not.toMatch(/\bstar(?:red)?\b/i);
  });
});
