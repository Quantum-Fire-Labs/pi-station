import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  detectServerTimezone,
  localToUtc,
  nextOccurrence,
  ScheduledJobScheduler,
  ScheduledJobStore,
  SettingsStore,
} from "../scheduled-jobs.js"

const directories: string[] = []
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "pi-scheduled-")); directories.push(path); return path }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const mutation = { title: "Review", prompt: "Review this Project", target: { type: "new-session" as const }, schedule: { type: "recurring" as const, frequency: "interval" as const, interval: 15, intervalUnit: "minute" as const } }

describe("Scheduled Jobs", () => {
  it("uses the server IANA timezone on first setup and falls back safely", async () => {
    const dataDir = await directory()
    expect(detectServerTimezone(() => "America/New_York")).toBe("America/New_York")
    expect(detectServerTimezone(() => "not-a-timezone")).toBe("UTC")
    expect(detectServerTimezone(() => { throw new Error("unavailable") })).toBe("UTC")
    expect(await new SettingsStore(dataDir, "America/New_York").read()).toEqual({
      timezone: "America/New_York",
    })
  })

  it("resolves a local one-time value and rejects DST gaps and folds", () => {
    expect(localToUtc("2026-01-15T09:30", "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z")
    expect(() => localToUtc("2026-03-08T02:30", "America/New_York")).toThrow("does not exist")
    expect(() => localToUtc("2026-11-01T01:30", "America/New_York")).toThrow("ambiguous")
  })

  it("keeps daily and weekly local time across DST", () => {
    expect(nextOccurrence({ type: "recurring", frequency: "daily", localTime: "09:00", timezone: "America/New_York", anchorUtc: "2026-03-07T14:00:00.000Z" }, new Date("2026-03-08T12:59:00.000Z")).toISOString()).toBe("2026-03-08T13:00:00.000Z")
    expect(nextOccurrence({ type: "recurring", frequency: "weekly", weekdays: [1, 3], localTime: "09:00", timezone: "America/New_York", anchorUtc: "2026-03-09T13:00:00.000Z" }, new Date("2026-03-09T13:00:00.000Z")).toISOString()).toBe("2026-03-11T13:00:00.000Z")
  })

  it("keeps calendar intervals at local wall time across DST", () => {
    const schedule = { type: "recurring" as const, frequency: "interval" as const, interval: 1, intervalUnit: "day" as const, timezone: "America/New_York", anchorUtc: "2026-03-07T14:00:00.000Z" }
    expect(nextOccurrence(schedule, new Date("2026-03-07T14:00:00.000Z")).toISOString()).toBe("2026-03-08T13:00:00.000Z")
  })

  it("preserves month-end and leap-day anchors", () => {
    const monthly = { type: "recurring" as const, frequency: "interval" as const, interval: 1, intervalUnit: "month" as const, timezone: "UTC", anchorUtc: "2026-01-31T09:00:00.000Z" }
    expect(nextOccurrence(monthly, new Date("2026-01-31T09:00:00.000Z")).toISOString()).toBe("2026-02-28T09:00:00.000Z")
    expect(nextOccurrence(monthly, new Date("2026-02-28T09:00:00.000Z")).toISOString()).toBe("2026-03-31T09:00:00.000Z")
    const yearly = { ...monthly, intervalUnit: "year" as const, anchorUtc: "2024-02-29T09:00:00.000Z" }
    expect(nextOccurrence(yearly, new Date("2027-03-01T00:00:00.000Z")).toISOString()).toBe("2028-02-29T09:00:00.000Z")
  })

  it("executes legacy stored minute intervals", () => {
    const legacy = { type: "recurring" as const, frequency: "interval" as const, intervalMinutes: 15, timezone: "UTC", anchorUtc: "2026-01-01T00:00:00.000Z" }
    expect(nextOccurrence(legacy, new Date("2026-01-01T00:16:00.000Z")).toISOString()).toBe("2026-01-01T00:30:00.000Z")
  })

  it("clamps monthly runs to month ends", () => {
    const schedule = { type: "recurring" as const, frequency: "monthly" as const, day: 31, localTime: "09:00", timezone: "UTC", anchorUtc: "2026-01-31T09:00:00.000Z" }
    expect(nextOccurrence(schedule, new Date("2026-02-01T00:00:00.000Z")).toISOString()).toBe("2026-02-28T09:00:00.000Z")
    expect(nextOccurrence(schedule, new Date("2028-02-01T00:00:00.000Z")).toISOString()).toBe("2028-02-29T09:00:00.000Z")
  })

  it("snapshots timezone and bounds history", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const store = new ScheduledJobStore(await directory(), () => now)
    let job = await store.create("project", mutation, "America/New_York")
    expect(job.schedule).toMatchObject({ type: "recurring", timezone: "America/New_York" })
    for (let index = 0; index < 105; index += 1) job = await store.record(job.id, { id: String(index), scheduledAt: now.toISOString(), attemptedAt: now.toISOString(), status: "succeeded", origin: "run-now" }, job.nextRunAt)
    expect(job.history).toHaveLength(100)
    expect(job.history[0]?.id).toBe("5")
  })

  it("runs one missed recurrence and selects the next future occurrence", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z")
    const store = new ScheduledJobStore(await directory(), () => now)
    const job = await store.create("project", mutation, "UTC")
    now = new Date("2026-01-01T01:01:00.000Z")
    let starts = 0
    const scheduler = new ScheduledJobScheduler(store, () => { starts += 1; return Promise.resolve({ status: "started", sessionId: "new", completion: Promise.resolve() }) }, () => now)
    await scheduler.tick()
    const updated = await store.get(job.id)
    expect(starts).toBe(1)
    expect(updated?.nextRunAt).toBe("2026-01-01T01:15:00.000Z")
  })

  it("keeps only one pending retry for a busy fixed Session", async () => {
    const now = new Date("2026-01-01T00:20:00.000Z")
    const store = new ScheduledJobStore(await directory(), () => now)
    const job = await store.create("project", { ...mutation, target: { type: "existing-session", sessionId: "session" } }, "UTC")
    const scheduler = new ScheduledJobScheduler(store, () => Promise.resolve({ status: "busy" }), () => now)
    const updated = await scheduler.run(job, "schedule")
    expect(updated.pending).toBe(true)
    expect(updated.nextRunAt).toBe("2026-01-01T00:21:00.000Z")
  })
})
