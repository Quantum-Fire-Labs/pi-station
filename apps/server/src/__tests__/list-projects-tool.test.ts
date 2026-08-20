import { describe, expect, it, vi } from "vitest"
import type { Project } from "@pi-station/application-protocol"
import { listProjectsTools } from "../session-runtime.js"

type ProjectTool = NonNullable<ReturnType<typeof listProjectsTools>[number]>

const requiredTool = (tools: ReturnType<typeof listProjectsTools>): ProjectTool => {
  const tool = tools[0]
  if (tool === undefined) throw new Error("list_projects tool is unavailable")
  return tool
}

const execute = (tool: ProjectTool) => tool.execute(
  "call",
  {},
  new AbortController().signal,
  () => undefined,
  {} as never,
)

describe("list_projects agent tool", () => {
  it("is available to a normal Project Session with a clear read-only definition and no parameters", () => {
    const tool = requiredTool(listProjectsTools(() => Promise.resolve([]), "project-1"))

    expect(tool.name).toBe("list_projects")
    expect(tool.label).toBe("List Pi Station Projects")
    expect(tool.description).toContain("does not change")
    expect((tool as { readonly parameters: unknown }).parameters).toMatchObject({ type: "object", properties: {}, additionalProperties: false })
  })

  it("is not available to a delegated child agent", () => {
    expect(listProjectsTools(() => Promise.resolve([]), "project-1", true)).toEqual([])
  })

  it("maps, marks, and sorts configured Projects by name and then ID", async () => {
    const configured: readonly Project[] = [
      { id: "z-id", root: "/work/z", name: "Same" },
      { id: "current-id", root: "/work/current", name: "Alpha" },
      { id: "a-id", root: "/work/a", name: "Same" },
    ]
    const list = vi.fn(() => Promise.resolve(configured))
    const tool = requiredTool(listProjectsTools(list, "current-id"))

    const result = await execute(tool)
    const projects = [
      { id: "current-id", name: "Alpha", workingDirectory: "/work/current", current: true },
      { id: "a-id", name: "Same", workingDirectory: "/work/a", current: false },
      { id: "z-id", name: "Same", workingDirectory: "/work/z", current: false },
    ]
    expect(list).toHaveBeenCalledOnce()
    expect(result.details).toEqual({ projects })
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(projects, null, 2) }])
  })

  it("reads the current list each time and returns an empty list", async () => {
    const list = vi.fn<() => Promise<readonly Project[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "new", root: "/work/new", name: "New" }])
    const tool = requiredTool(listProjectsTools(list, "current"))

    expect((await execute(tool)).details).toEqual({ projects: [] })
    expect((await execute(tool)).details).toEqual({
      projects: [{ id: "new", name: "New", workingDirectory: "/work/new", current: false }],
    })
  })

  it("reports a Project Store read error", async () => {
    const tool = requiredTool(listProjectsTools(() => Promise.reject(new Error("Project Store is unavailable")), "current"))

    await expect(execute(tool)).rejects.toThrow("Project Store is unavailable")
  })
})
