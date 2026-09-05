import { describe, expect, it, vi } from "vitest"
import { CommandApprovalService, requiresRecursiveRmApproval } from "../command-approval.js"

describe("recursive rm guard", () => {
  it.each([
    "rm -rf build",
    "rm -fr build",
    "rm -r build",
    "rm --recursive build",
    "cd /tmp && rm -rf example",
    "sudo rm -rf example",
  ])("requires approval for %s", (command) => {
    expect(requiresRecursiveRmApproval(command)).toBe(true)
  })

  it.each([
    "rm file.txt",
    "echo rm -rf build",
    "printf 'rm -rf build'",
    "npm run build",
  ])("does not require approval for %s", (command) => {
    expect(requiresRecursiveRmApproval(command)).toBe(false)
  })

  it("allows or blocks exactly one pending request", async () => {
    const service = new CommandApprovalService(10_000)
    let approvalId: string | undefined
    service.subscribe((event) => { if (event.type === "requested") approvalId = event.approval.id })
    const result = service.request({ projectId: "project", sessionId: "session" }, "rm -rf build")
    expect(approvalId).toBeTypeOf("string")
    expect(service.current({ projectId: "project", sessionId: "session" })).toMatchObject({ id: approvalId, command: "rm -rf build" })
    expect(service.current({ projectId: "other", sessionId: "session" })).toBeUndefined()
    expect(service.resolve({ projectId: "other", sessionId: "session" }, approvalId!, true)).toBe(false)
    expect(service.resolve({ projectId: "project", sessionId: "session" }, approvalId!, true)).toBe(true)
    await expect(result).resolves.toBe(true)
    expect(service.current({ projectId: "project", sessionId: "session" })).toBeUndefined()
    expect(service.resolve({ projectId: "project", sessionId: "session" }, approvalId!, true)).toBe(false)
  })

  it("keeps delegation approval text and Session scope separate from command approval", async () => {
    const service = new CommandApprovalService(10_000)
    const result = service.requestDelegation(
      { projectId: "project", sessionId: "parent" },
      "anthropic/claude-sonnet-4-6",
      "high",
    )
    const approval = service.current({ projectId: "project", sessionId: "parent" })
    expect(approval).toMatchObject({ kind: "delegation", model: "anthropic/claude-sonnet-4-6", thinkingLevel: "high" })
    expect(service.resolve({ projectId: "project", sessionId: "other" }, approval!.id, true)).toBe(false)
    expect(service.resolve({ projectId: "project", sessionId: "parent" }, approval!.id, false)).toBe(true)
    await expect(result).resolves.toBe(false)
  })

  it("fails closed on timeout, cancellation, and service close", async () => {
    vi.useFakeTimers()
    try {
      const service = new CommandApprovalService(50)
      const timeout = service.requestDelegation({ projectId: "p", sessionId: "timeout" }, "openai/gpt", "low")
      await vi.advanceTimersByTimeAsync(50)
      await expect(timeout).resolves.toBe(false)

      const controller = new AbortController()
      const cancelled = service.requestDelegation({ projectId: "p", sessionId: "cancelled" }, "openai/gpt", "low", controller.signal)
      controller.abort()
      await expect(cancelled).resolves.toBe(false)

      const unavailable = service.requestDelegation({ projectId: "p", sessionId: "closed" }, "openai/gpt", "low")
      service.close()
      await expect(unavailable).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
