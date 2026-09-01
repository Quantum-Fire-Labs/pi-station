// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "./CommandPalette"

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

  it("opens the stashes flow directly and aligns its empty state with options", () => {
    render(<CommandPalette {...required} initialFlow="stashes" sessionId="session" stashes={[]} onRestoreStash={vi.fn()} />)
    const empty = screen.getByRole("status")
    expect(screen.getByRole("dialog", { name: "Stashed messages" })).toBeVisible()
    expect(empty).toHaveClass("palette-empty-option")
    expect(empty.querySelector(".palette-option-glyph")).not.toBeNull()
    expect(empty.querySelector(".palette-option-copy")).toHaveTextContent("No stashed messages.")
  })
})
