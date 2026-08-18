import { describe, expect, it } from "vitest"
import { encodeSse, isModelSettingRequest, isNewTurnRequest, isPrompt, isSessionStateRequest, isThinkingSettingRequest, isTimelineImage } from "../index.js"

describe("Pi Station protocol", () => {
  it("accepts only bounded non-empty prompts", () => {
    expect(isPrompt({ prompt: "hello" })).toBe(true)
    expect(isPrompt({ prompt: "  " })).toBe(false)
    expect(isPrompt({ prompt: "ok", extra: true })).toBe(false)
    expect(isNewTurnRequest({ prompt: "ok", name: "Name" })).toBe(true)
    expect(isNewTurnRequest({ prompt: "ok", unexpected: true })).toBe(false)
    expect(isNewTurnRequest({ prompt: "", imageIds: ["upload_a"] })).toBe(true)
    expect(isPrompt({ prompt: "next", imageIds: ["upload-a"] })).toBe(true)
    expect(isPrompt({ prompt: "", attachmentIds: ["file-a"] })).toBe(true)
    expect(isPrompt({ prompt: "ok", imageIds: ["1", "2"], attachmentIds: ["3", "4", "5"] })).toBe(false)
    expect(isPrompt({ prompt: "", imageIds: [] })).toBe(false)
    expect(isPrompt({ prompt: "ok", imageIds: ["same", "same"] })).toBe(false)
    expect(isPrompt({ prompt: "ok", imageIds: ["1", "2", "3", "4", "5"] })).toBe(false)
    expect(isSessionStateRequest({ state: "open" })).toBe(true)
    expect(isSessionStateRequest({ state: "closed" })).toBe(true)
    expect(isSessionStateRequest({ state: "active" })).toBe(false)
    expect(isSessionStateRequest({ state: "archived" })).toBe(false)
  })

  it("validates strict model and thinking settings", () => {
    expect(isModelSettingRequest({ provider: "anthropic", modelId: "claude-test" })).toBe(true)
    expect(isModelSettingRequest({ provider: "anthropic", modelId: "", extra: true })).toBe(false)
    expect(isThinkingSettingRequest({ level: "max" })).toBe(true)
    expect(isThinkingSettingRequest({ level: "extreme" })).toBe(false)
    expect(isThinkingSettingRequest({ level: "high", extra: true })).toBe(false)
  })

  it("accepts only bounded opaque saved-image references", () => {
    expect(isTimelineImage({ id: "saved_image-1", mediaType: "image/png", status: "available" })).toBe(true)
    expect(isTimelineImage({ status: "unavailable" })).toBe(true)
    expect(isTimelineImage({ id: "saved_image-1", mediaType: "image/svg+xml", status: "available" })).toBe(false)
    expect(isTimelineImage({ id: "../session.jsonl", mediaType: "image/png", status: "available" })).toBe(false)
    expect(isTimelineImage({ id: "x".repeat(513), mediaType: "image/png", status: "available" })).toBe(false)
    expect(isTimelineImage({ status: "unavailable", data: "raw SDK object" })).toBe(false)
  })

  it("encodes one strict SSE record", () => {
    expect(encodeSse({ version: 2, type: "phase", phase: "working", epoch: "server-epoch", generation: 1 })).toBe(
      "event: phase\ndata: {\"version\":2,\"type\":\"phase\",\"phase\":\"working\",\"epoch\":\"server-epoch\",\"generation\":1}\n\n",
    )
  })
})
