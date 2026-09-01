import { describe, expect, it } from "vitest"
import { isCreateMessageStashRequest } from "./message-stashes.js"

describe("message stash protocol", () => {
  it("accepts text or uploads and rejects empty and excessive content", () => {
    expect(isCreateMessageStashRequest({ text: "later" })).toBe(true)
    expect(isCreateMessageStashRequest({ text: "", imageIds: ["image"] })).toBe(true)
    expect(isCreateMessageStashRequest({ text: "" })).toBe(false)
    expect(isCreateMessageStashRequest({ text: "x", imageIds: ["1", "2", "3"], attachmentIds: ["4", "5"] })).toBe(false)
    expect(isCreateMessageStashRequest({ text: "x", extra: true })).toBe(false)
  })
})
