import { describe, expect, it, vi } from "vitest"
import { NewAgentInProjectBridge } from "../new-agent-in-project.js"
import { newAgentInProjectTools } from "../session-runtime.js"

type Tool = NonNullable<ReturnType<typeof newAgentInProjectTools>[number]>

function requiredTool(bridge: NewAgentInProjectBridge): Tool {
  const tool = newAgentInProjectTools(bridge)[0]
  if (tool === undefined) throw new Error("new_agent_in_project tool is unavailable")
  return tool
}

function execute(tool: Tool, parameters: { projectId: string; name: string; prompt: string }) {
  return tool.execute("call", parameters, new AbortController().signal, () => undefined, {} as never)
}

describe("new_agent_in_project agent tool", () => {
  it("has the required schema and explains top-level default behavior", () => {
    const tool = requiredTool(new NewAgentInProjectBridge())

    expect(tool.name).toBe("new_agent_in_project")
    expect(tool.description).toContain("independent top-level agent Session")
    expect(tool.description).toContain("Project working directory and default model settings")
    expect(tool.description).toContain("immediately receives the prompt")
    expect(tool.description).toContain("not a delegated agent")
    expect((tool as { readonly parameters: unknown }).parameters).toMatchObject({
      type: "object",
      required: ["projectId", "name", "prompt"],
      additionalProperties: false,
      properties: {
        projectId: { type: "string", minLength: 1, maxLength: 200 },
        name: { type: "string", minLength: 1, maxLength: 120 },
        prompt: { type: "string", minLength: 1, maxLength: 100000 },
      },
    })
  })

  it("is excluded from delegated child agents", () => {
    expect(newAgentInProjectTools(new NewAgentInProjectBridge(), true)).toEqual([])
  })

  it("passes only the exact Project ID, name, and prompt and returns readable structured status", async () => {
    const bridge = new NewAgentInProjectBridge()
    const handler = vi.fn().mockResolvedValue({ status: "started", sessionId: "session-2", projectId: "project-2" })
    bridge.bind(handler)
    const input = { projectId: "project-2", name: "Review", prompt: "Review the tests" }

    const result = await execute(requiredTool(bridge), input)

    expect(handler).toHaveBeenCalledWith(input)
    expect(result.content).toEqual([{ type: "text", text: "Started top-level Session session-2 in Project project-2" }])
    expect(result.details).toEqual({ status: "started", sessionId: "session-2", projectId: "project-2" })
  })

  it("reports unavailable and host creation failures", async () => {
    await expect(execute(requiredTool(new NewAgentInProjectBridge()), { projectId: "missing", name: "Test", prompt: "Go" }))
      .rejects.toThrow("unavailable")

    const bridge = new NewAgentInProjectBridge()
    bridge.bind(() => Promise.reject(new Error("Project not found: missing")))
    await expect(execute(requiredTool(bridge), { projectId: "missing", name: "Test", prompt: "Go" }))
      .rejects.toThrow("Project not found: missing")
  })
})
