export const MAX_SCHEDULED_JOBS_PER_PROJECT = 100
export const MIN_RECURRENCE_MINUTES = 15
export const MAX_RECURRENCE_INTERVAL = 1_000_000
export type IntervalUnit = "minute" | "hour" | "day" | "week" | "month" | "year"

export type ScheduledJobTarget =
  | { readonly type: "new-session" }
  | { readonly type: "existing-session"; readonly sessionId: string }

export type IntervalRecurrence = { readonly frequency: "interval"; readonly interval: number; readonly intervalUnit: IntervalUnit; readonly localStart?: string }
export type LegacyIntervalRecurrence = { readonly frequency: "interval"; readonly intervalMinutes: number; readonly localStart?: string }
export type Recurrence =
  | IntervalRecurrence
  | { readonly frequency: "daily"; readonly localTime: string }
  | { readonly frequency: "weekly"; readonly weekdays: readonly number[]; readonly localTime: string }
  | { readonly frequency: "monthly"; readonly day: number; readonly localTime: string }
export type StoredRecurrence = Recurrence | LegacyIntervalRecurrence

export type ScheduledJobSchedule =
  | { readonly type: "one-time"; readonly runAtUtc: string; readonly timezone: string }
  | ({ readonly type: "recurring"; readonly timezone: string; readonly anchorUtc: string } & StoredRecurrence)

export type ScheduledJobState = "active" | "paused" | "disabled"
export type ScheduledRunStatus = "succeeded" | "deferred" | "failed"
export interface ScheduledRun { readonly id: string; readonly scheduledAt: string; readonly attemptedAt: string; readonly completedAt?: string; readonly status: ScheduledRunStatus; readonly sessionId?: string; readonly message?: string; readonly origin: "schedule" | "run-now" }
export interface ScheduledJob { readonly id: string; readonly projectId: string; readonly title: string; readonly prompt: string; readonly target: ScheduledJobTarget; readonly schedule: ScheduledJobSchedule; readonly state: ScheduledJobState; readonly nextRunAt?: string; readonly pending: boolean; readonly createdAt: string; readonly updatedAt: string; readonly createdBy?: string; readonly updatedBy?: string; readonly history: readonly ScheduledRun[] }
export interface ScheduledJobMutation { readonly title: string; readonly prompt: string; readonly target: ScheduledJobTarget; readonly schedule: { readonly type: "one-time"; readonly localDateTime: string } | ({ readonly type: "recurring" } & Recurrence); readonly actor?: string }
export interface PiStationSettings { readonly timezone: string }

const record = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key))
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max
const localDateTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)
const localTime = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u.test(value)
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const units: readonly IntervalUnit[] = ["minute", "hour", "day", "week", "month", "year"]
export function intervalMinutes(interval: number, unit: IntervalUnit): number { return interval * ({ minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 }[unit]) }
export function validInterval(interval: unknown, unit: unknown): boolean { if (!Number.isSafeInteger(interval) || Number(interval) <= 0 || !units.includes(unit as IntervalUnit)) return false; const limit = unit === "year" ? 1_000 : unit === "month" ? 10_000 : MAX_RECURRENCE_INTERVAL; return Number(interval) <= limit && Number.isSafeInteger(intervalMinutes(Number(interval), unit as IntervalUnit)) && intervalMinutes(Number(interval), unit as IntervalUnit) >= MIN_RECURRENCE_MINUTES }
export function isIanaTimezone(value: unknown): value is string { if (typeof value !== "string" || value.length > 128) return false; try { new Intl.DateTimeFormat("en", { timeZone: value }); return true } catch { return false } }
function isTarget(value: unknown): value is ScheduledJobTarget { const target = record(value); if (target === undefined) return false; return target.type === "new-session" ? exact(target, ["type"]) : target.type === "existing-session" && exact(target, ["type", "sessionId"]) && text(target.sessionId, 200) }
function isRecurrence(value: Record<string, unknown>, withType: boolean, legacy: boolean): boolean {
  const prefix = withType ? ["type"] : []
  if (value.frequency === "interval") {
    if (legacy && "intervalMinutes" in value) return exact(value, [...prefix,"frequency","intervalMinutes","localStart"]) && Number.isSafeInteger(value.intervalMinutes) && Number(value.intervalMinutes) >= MIN_RECURRENCE_MINUTES && (value.localStart === undefined || localDateTime(value.localStart))
    return exact(value, [...prefix,"frequency","interval","intervalUnit","localStart"]) && validInterval(value.interval, value.intervalUnit) && (value.localStart === undefined || localDateTime(value.localStart))
  }
  if (value.frequency === "daily") return exact(value, [...prefix,"frequency","localTime"]) && localTime(value.localTime)
  if (value.frequency === "weekly") return exact(value, [...prefix,"frequency","weekdays","localTime"]) && localTime(value.localTime) && Array.isArray(value.weekdays) && value.weekdays.length > 0 && value.weekdays.length <= 7 && value.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(value.weekdays).size === value.weekdays.length
  return value.frequency === "monthly" && exact(value, [...prefix,"frequency","day","localTime"]) && Number.isInteger(value.day) && Number(value.day) >= 1 && Number(value.day) <= 31 && localTime(value.localTime)
}
export function isScheduledJobMutation(value: unknown): value is ScheduledJobMutation { const input = record(value); if (input === undefined || !exact(input,["title","prompt","target","schedule","actor"]) || !text(input.title,200) || !text(input.prompt,100_000) || !isTarget(input.target) || (input.actor !== undefined && !text(input.actor,200))) return false; const schedule=record(input.schedule); return schedule !== undefined && (schedule.type === "one-time" ? exact(schedule,["type","localDateTime"]) && localDateTime(schedule.localDateTime) : schedule.type === "recurring" && isRecurrence(schedule,true,false)) }
export function isScheduledJob(value: unknown): value is ScheduledJob {
  const job=record(value); if (job===undefined || !exact(job,["id","projectId","title","prompt","target","schedule","state","nextRunAt","pending","createdAt","updatedAt","createdBy","updatedBy","history"]) || !text(job.id,200) || !text(job.projectId,200) || !text(job.title,200) || !text(job.prompt,100_000) || !isTarget(job.target) || !["active","paused","disabled"].includes(String(job.state)) || typeof job.pending!=="boolean" || !iso(job.createdAt) || !iso(job.updatedAt) || (job.nextRunAt!==undefined&&!iso(job.nextRunAt)) || !Array.isArray(job.history)) return false
  const schedule=record(job.schedule); if (schedule===undefined || !isIanaTimezone(schedule.timezone) || !iso(schedule.anchorUtc ?? schedule.runAtUtc)) return false
  if (schedule.type==="one-time") { if (!exact(schedule,["type","runAtUtc","timezone"]) || !iso(schedule.runAtUtc)) return false } else if (schedule.type!=="recurring" || !exact(schedule,["type","timezone","anchorUtc","frequency","interval","intervalUnit","intervalMinutes","localStart","localTime","weekdays","day"]) || !isRecurrence(Object.fromEntries(Object.entries(schedule).filter(([key])=>!["type","timezone","anchorUtc"].includes(key))),false,true)) return false
  return job.history.every(isScheduledRun)
}
function isScheduledRun(value: unknown): value is ScheduledRun { const run=record(value); return run!==undefined && exact(run,["id","scheduledAt","attemptedAt","completedAt","status","sessionId","message","origin"]) && text(run.id,200) && iso(run.scheduledAt) && iso(run.attemptedAt) && (run.completedAt===undefined||iso(run.completedAt)) && ["succeeded","deferred","failed"].includes(String(run.status)) && ["schedule","run-now"].includes(String(run.origin)) }
