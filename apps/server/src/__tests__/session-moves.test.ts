import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { SessionMoveAgentBridge, rewriteSessionCwd } from "../session-moves.js"
import { moveSessionTools } from "../session-runtime.js"

const execute = (tool: ReturnType<typeof moveSessionTools>[number], projectId: string) => tool.execute("call", { projectId }, new AbortController().signal, () => undefined, {} as never)

describe("Session moves", () => {
  it("changes only cwd in the header and preserves identity and complete history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-move-"))
    const path = join(directory, "session.jsonl")
    const entries = [
      { type: "session", version: 3, id: "same-id", timestamp: "2026-01-01T00:00:00Z", cwd: "/old" },
      { type: "message", id: "one", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: "history" } },
    ]
    await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)

    await rewriteSessionCwd(path, "/target")

    const changed: unknown[] = (await readFile(path, "utf8")).trim().split("\n").map((line): unknown => JSON.parse(line) as unknown)
    expect(changed[0]).toEqual({ ...entries[0], cwd: "/target" })
    expect(changed[1]).toEqual(entries[1])
  })

  it("defines an exact self-only tool and returns a scheduled result", async () => {
    const bridge = new SessionMoveAgentBridge()
    const invoke = vi.fn().mockResolvedValue({ status: "scheduled", projectId: "target", projectName: "Target" })
    bridge.bind(invoke)
    const tool = moveSessionTools(bridge, "calling-session", "current")[0]!

    expect(tool.name).toBe("move_session_to_project")
    expect((tool as { parameters: unknown }).parameters).toMatchObject({ type: "object", required: ["projectId"], additionalProperties: false })
    const result = await execute(tool, "target")
    expect(invoke).toHaveBeenCalledWith({ sessionId: "calling-session", projectId: "target" })
    expect(result.details).toEqual({ status: "scheduled", projectId: "target", projectName: "Target" })
    const content = result.content[0]
    expect(content?.type).toBe("text")
    if (content?.type !== "text") throw new Error("Expected text tool output")
    expect(content.text).toContain("after this complete turn ends")
  })

  it("does not expose the tool outside a Project or to delegated agents", () => {
    const bridge = new SessionMoveAgentBridge()
    expect(moveSessionTools(bridge, "session")).toEqual([])
    expect(moveSessionTools(bridge, "session", "project", true)).toEqual([])
  })
})
