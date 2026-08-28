import { describe, expect, it, vi } from "vitest"
import type { Project } from "@pi-station/application-protocol"
import { createProjectTools } from "../session-runtime.js"

type ProjectTool = NonNullable<ReturnType<typeof createProjectTools>[number]>

const requiredTool = (tools: ReturnType<typeof createProjectTools>): ProjectTool => {
  const tool = tools[0]
  if (tool === undefined) throw new Error("create_project tool is unavailable")
  return tool
}

const execute = (tool: ProjectTool, parameters: { name: string; directory: string }) => tool.execute(
  "call",
  parameters,
  new AbortController().signal,
  () => undefined,
  {} as never,
)

describe("create_project agent tool", () => {
  it("clearly configures an existing directory without claiming to create it", () => {
    const tool = requiredTool(createProjectTools(() => Promise.reject(new Error("unused"))))

    expect(tool.name).toBe("create_project")
    expect(tool.label).toBe("Create Pi Station Project")
    expect(tool.description).toContain("existing directory")
    expect(tool.description).toContain("does not create or modify")
    expect((tool as { readonly parameters: unknown }).parameters).toMatchObject({
      type: "object",
      required: ["name", "directory"],
      additionalProperties: false,
    })
  })

  it("is unavailable to delegated child agents", () => {
    expect(createProjectTools(() => Promise.reject(new Error("unused")), true)).toEqual([])
  })

  it("creates and returns the configured Project", async () => {
    const project: Project = { id: "project-id", root: "/work/example", name: "Example" }
    const create = vi.fn(() => Promise.resolve(project))
    const result = await execute(requiredTool(createProjectTools(create)), { name: "Example", directory: "/work/example" })

    expect(create).toHaveBeenCalledWith({ name: "Example", directory: "/work/example" })
    expect(result.details).toEqual({ project })
    expect(result.content).toEqual([{ type: "text", text: "Created Project Example (project-id) at /work/example" }])
  })

  it("reports Project creation errors", async () => {
    const tool = requiredTool(createProjectTools(() => Promise.reject(new Error("Project root does not exist"))))

    await expect(execute(tool, { name: "Missing", directory: "/missing" })).rejects.toThrow("Project root does not exist")
  })
})
