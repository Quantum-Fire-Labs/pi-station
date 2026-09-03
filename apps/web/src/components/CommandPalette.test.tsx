// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "./CommandPalette"
import type { ProjectSummary } from "../application/workspace-model"

const required = { onClose: vi.fn(), onDashboard: vi.fn(), onProjects: vi.fn(), onAddProject: vi.fn() }
describe("CommandPalette stashed messages", () => {
  afterEach(cleanup)
  it("opens a second list with preview and creation time and selects a stash", async () => {
    const user = userEvent.setup(); const onRestoreStash = vi.fn()
    const stash = { id: "stash", text: "Continue this work tomorrow", createdAt: "2026-03-01T12:00:00.000Z", images: [], attachments: [] }
    render(<CommandPalette {...required} sessionId="session" stashes={[stash]} onRestoreStash={onRestoreStash} />)
    await user.click(screen.getByRole("option", { name: /Stashed messages/i }))
    expect(screen.getByRole("listbox", { name: "Stashed messages" }).textContent).toContain("Continue this work tomorrow")
    expect(screen.getByRole("listbox", { name: "Stashed messages" }).textContent).toContain("2026")
    await user.click(screen.getByRole("option", { name: /Continue this work tomorrow/i }))
    expect(onRestoreStash).toHaveBeenCalledWith(stash)
  })

  it("lists Workspaces and selects one", async () => {
    const user = userEvent.setup()
    const onSelectWorkspace = vi.fn()
    const workspaces = [
      { id: "agency", name: "Marketing Agency", projectIds: ["site"], closedProjectIds: [], bookmarkedProjectIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "product", name: "Product", projectIds: ["app", "api"], closedProjectIds: [], bookmarkedProjectIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]
    render(<CommandPalette {...required} workspaces={workspaces} activeWorkspaceId="agency" onSelectWorkspace={onSelectWorkspace} />)

    await user.click(screen.getByRole("option", { name: "Workspaces" }))
    expect(screen.getByRole("dialog", { name: "Workspaces" })).toBeVisible()
    expect(screen.getByRole("option", { name: "Marketing Agency" })).not.toHaveTextContent("Project")
    expect(screen.getByRole("option", { name: "Product" })).not.toHaveTextContent("Project")
    await user.type(screen.getByRole("textbox", { name: "Search Workspaces" }), "prod")
    expect(screen.queryByRole("option", { name: "Marketing Agency" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "Product" }))

    expect(onSelectWorkspace).toHaveBeenCalledWith("product")
    expect(required.onClose).toHaveBeenCalled()
  })

  it("opens the stashes flow directly and aligns its empty state with options", () => {
    render(<CommandPalette {...required} initialFlow="stashes" sessionId="session" stashes={[]} onRestoreStash={vi.fn()} />)
    const empty = screen.getByRole("status")
    expect(screen.getByRole("dialog", { name: "Stashed messages" })).toBeVisible()
    expect(empty).toHaveClass("palette-empty-option")
    expect(empty.querySelector(".palette-option-glyph")).not.toBeNull()
    expect(empty.querySelector(".palette-option-copy")).toHaveTextContent("No stashed messages.")
  })
})

describe("CommandPalette project browser", () => {
  afterEach(cleanup)
  const project = (projectId: string, name: string, available = true): ProjectSummary => ({ projectId, name, available, displayPath: `/work/${name}`, createdAt: "2026-01-01", updatedAt: "2026-01-01" })

  it("sorts and filters Projects, and keeps unavailable Projects disabled", async () => {
    const user = userEvent.setup()
    render(<CommandPalette {...required} projects={[project("z", "Zulu"), project("a", "Alpha"), project("b", "Beta", false)]} projectBookmarkIds={["z"]} />)
    await user.click(screen.getByRole("option", { name: "Projects" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Zulu/work/Zulu", "Alpha/work/Alpha", "Beta/work/Beta · Unavailable"])
    expect(screen.getByRole<HTMLButtonElement>("option", { name: /Beta/ }).disabled).toBe(true)
    await user.type(screen.getByPlaceholderText("Search Projects…"), "alp")
    expect(screen.getAllByRole("option")).toHaveLength(1)
  })

  it("sorts and searches Project Sessions, and goes back through both levels", async () => {
    const user = userEvent.setup()
    render(<CommandPalette {...required} projects={[project("a", "Alpha")]} sessions={[{ id: "closed", name: "Charlie", projectId: "a", closed: true }, { id: "open", name: "Bravo", projectId: "a", closed: false }, { id: "saved", name: "Zulu", projectId: "a", bookmarked: true, closed: true }, { id: "unnamed", name: "Untitled conversation", projectId: "a", closed: false }]} onOpenSession={vi.fn()} />)
    await user.click(screen.getByRole("option", { name: "Projects" }))
    await user.click(screen.getByRole("option", { name: /Alpha/ }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["ZuluBookmarked · Closed", "Bravo", "Untitled conversation", "CharlieClosed"])
    await user.type(screen.getByPlaceholderText("Search Sessions…"), "untitled")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.keyboard("{Escape}")
    expect(screen.getByPlaceholderText("Search Projects…")).not.toBeNull()
    await user.keyboard("{Escape}")
    expect(screen.getByPlaceholderText("Choose an action…")).not.toBeNull()
  })

  it.each([{ closed: false, id: "open" }, { closed: true, id: "closed" }])("selects and navigates to a $id Session", async ({ closed, id }) => {
    const user = userEvent.setup(); const onOpenSession = vi.fn(); const onClose = vi.fn()
    render(<CommandPalette {...required} onClose={onClose} projects={[project("a", "Alpha")]} sessions={[{ id, name: id, projectId: "a", closed }]} onOpenSession={onOpenSession} />)
    await user.click(screen.getByRole("option", { name: "Projects" }))
    await user.click(screen.getByRole("option", { name: /Alpha/ }))
    await user.click(screen.getByRole("option", { name: new RegExp(id) }))
    expect(onOpenSession).toHaveBeenCalledWith(id)
    expect(onClose).toHaveBeenCalled()
  })
})
