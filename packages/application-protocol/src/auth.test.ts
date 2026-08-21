import { describe, expect, it } from "vitest"
import { isAuthLoginRequest, isAuthPromptResponse } from "./auth.js"

describe("provider auth protocol", () => {
  it("accepts strict login requests", () => {
    expect(isAuthLoginRequest({ providerId: "openai-codex", type: "oauth" })).toBe(true)
    expect(isAuthLoginRequest({ providerId: "openai", type: "password" })).toBe(false)
    expect(isAuthLoginRequest({ providerId: "openai", type: "api_key", credential: "secret" })).toBe(false)
  })
  it("accepts one bounded prompt response", () => {
    expect(isAuthPromptResponse({ value: "code" })).toBe(true)
    expect(isAuthPromptResponse({ value: "code", providerId: "x" })).toBe(false)
    expect(isAuthPromptResponse({ value: "x".repeat(20_001) })).toBe(false)
  })
})
