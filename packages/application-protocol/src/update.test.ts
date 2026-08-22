import { describe, expect, it } from "vitest"
import { isUpdateChannelMutation } from "./update.js"

describe("update protocol", () => {
  it("accepts only a strict stable or edge channel mutation", () => {
    expect(isUpdateChannelMutation({ channel: "stable" })).toBe(true)
    expect(isUpdateChannelMutation({ channel: "edge" })).toBe(true)
    expect(isUpdateChannelMutation({ channel: "nightly" })).toBe(false)
    expect(isUpdateChannelMutation({ channel: "stable", token: "secret" })).toBe(false)
  })
})
