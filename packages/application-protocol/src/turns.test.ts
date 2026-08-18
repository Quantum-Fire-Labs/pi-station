import { describe, expect, it } from "vitest"
import { isNewTurnRequest, isPrompt } from "./turns.js"

describe("agent mention prompt metadata", () => {
  it("accepts stable Session IDs with display labels", () => {
    const prompt = { prompt: "Ask @\"Pi Station: Themes\"", agentMentions: [{ sessionId: "session-themes", label: "Pi Station: Themes" }] }
    expect(isPrompt(prompt)).toBe(true)
    expect(isNewTurnRequest(prompt)).toBe(true)
    expect(isNewTurnRequest({ prompt: "run", cwd: "/home/example" })).toBe(true)
    expect(isNewTurnRequest({ prompt: "run", cwd: "" })).toBe(false)
  })

  it("rejects incomplete mention metadata", () => {
    expect(isPrompt({ prompt: "Ask Themes", agentMentions: [{ label: "Themes" }] })).toBe(false)
  })
})
