import { describe, expect, it } from "vitest"
import { isIanaTimezone, isScheduledJobMutation } from "./scheduled-jobs.js"

describe("Scheduled Job protocol", () => {
  it("accepts strict mutations without timezone", () => {
    expect(isScheduledJobMutation({ title: "Daily review", prompt: "Review", target: { type: "new-session" }, schedule: { type: "recurring", frequency: "interval", interval: 1, intervalUnit: "hour" } })).toBe(true)
    expect(isScheduledJobMutation({ title: "Daily review", prompt: "Review", target: { type: "new-session" }, schedule: { type: "recurring", frequency: "interval", interval: 14, intervalUnit: "minute" } })).toBe(false)
    expect(isScheduledJobMutation({ title: "Daily review", prompt: "Review", target: { type: "new-session" }, schedule: { type: "recurring", frequency: "interval", interval: 1_000_001, intervalUnit: "year" } })).toBe(false)
    expect(isScheduledJobMutation({ title: "Legacy", prompt: "Review", target: { type: "new-session" }, schedule: { type: "recurring", frequency: "interval", intervalMinutes: 15 } })).toBe(false)
    expect(isScheduledJobMutation({ title: "Review", prompt: "Review", target: { type: "new-session" }, schedule: { type: "one-time", localDateTime: "2026-01-01T10:00", timezone: "UTC" } })).toBe(false)
  })
  it("validates IANA timezones", () => {
    expect(isIanaTimezone("America/New_York")).toBe(true)
    expect(isIanaTimezone("Not/A_Zone")).toBe(false)
  })
})
