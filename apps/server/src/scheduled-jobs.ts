import { randomUUID } from "node:crypto"
import { join } from "node:path"
import {
  isIanaTimezone,
  isScheduledJob,
  MAX_SCHEDULED_JOBS_PER_PROJECT,
  intervalMinutes,
  validInterval,
  type PiStationSettings,
  type IntervalRecurrence,
  type IntervalUnit,
  type Recurrence,
  type ScheduledJob,
  type ScheduledJobMutation,
  type ScheduledRun,
} from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

const HISTORY_LIMIT = 100
const RETRY_MS = 60_000
interface JobData { readonly version: 1; readonly jobs: readonly ScheduledJob[] }
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isData = (value: unknown): value is JobData => isObject(value) && value.version === 1 && Array.isArray(value.jobs) && value.jobs.every(isStoredJob)
const isStoredJob = isScheduledJob
const isSettings = (value: unknown): value is PiStationSettings => isObject(value) && Object.keys(value).length === 1 && isIanaTimezone(value.timezone)

export function detectServerTimezone(
  resolvedTimezone: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const timezone = resolvedTimezone()
    return isIanaTimezone(timezone) ? timezone : "UTC"
  } catch {
    return "UTC"
  }
}

export class SettingsStore {
  readonly #store: AtomicJsonStore<PiStationSettings>
  readonly #defaultTimezone: string
  constructor(dataDir: string, defaultTimezone = detectServerTimezone()) {
    this.#store = new AtomicJsonStore(join(dataDir, "settings.json"), isSettings)
    this.#defaultTimezone = isIanaTimezone(defaultTimezone) ? defaultTimezone : "UTC"
  }
  read(): Promise<PiStationSettings> { return this.#store.read({ timezone: this.#defaultTimezone }) }
  replace(timezone: string): Promise<PiStationSettings> {
    if (!isIanaTimezone(timezone)) throw new Error("Timezone must be an IANA timezone")
    return this.#store.replace({ timezone })
  }
}

export class ScheduledJobError extends Error {
  constructor(readonly code: "not-found" | "limit" | "invalid", message: string) { super(message) }
}

export class ScheduledJobStore {
  readonly #store: AtomicJsonStore<JobData>
  readonly #now: () => Date
  constructor(dataDir: string, now: () => Date = () => new Date()) {
    this.#store = new AtomicJsonStore(join(dataDir, "scheduled-jobs.json"), isData)
    this.#now = now
  }
  async list(projectId?: string): Promise<readonly ScheduledJob[]> {
    const jobs = (await this.#store.read({ version: 1, jobs: [] })).jobs
    return projectId === undefined ? jobs : jobs.filter((job) => job.projectId === projectId)
  }
  async get(id: string): Promise<ScheduledJob | undefined> { return (await this.list()).find((job) => job.id === id) }
  async create(projectId: string, input: ScheduledJobMutation, timezone: string): Promise<ScheduledJob> {
    const now = this.#now().toISOString()
    const job: ScheduledJob = { id: randomUUID(), projectId, title: input.title.trim(), prompt: input.prompt.trim(), target: input.target, schedule: normalizeSchedule(input.schedule, timezone, this.#now()), state: "active", nextRunAt: scheduleFirst(input.schedule, timezone, this.#now()).toISOString(), pending: false, createdAt: now, updatedAt: now, ...(input.actor === undefined ? {} : { createdBy: input.actor, updatedBy: input.actor }), history: [] }
    await this.#store.update({ version: 1, jobs: [] }, (data) => {
      if (data.jobs.filter((item) => item.projectId === projectId).length >= MAX_SCHEDULED_JOBS_PER_PROJECT) throw new ScheduledJobError("limit", "A Project can have at most 100 Scheduled Jobs")
      return { version: 1, jobs: [...data.jobs, job] }
    })
    return job
  }
  async update(id: string, input: ScheduledJobMutation, timezone: string): Promise<ScheduledJob> {
    const now = this.#now()
    return this.#change(id, (job) => ({ ...job, title: input.title.trim(), prompt: input.prompt.trim(), target: input.target, schedule: normalizeSchedule(input.schedule, timezone, now), state: job.state === "disabled" ? "disabled" : "active", nextRunAt: scheduleFirst(input.schedule, timezone, now).toISOString(), pending: false, updatedAt: now.toISOString(), ...(input.actor === undefined ? {} : { updatedBy: input.actor }) }))
  }
  setState(id: string, state: "active" | "paused", actor?: string): Promise<ScheduledJob> {
    return this.#change(id, (job) => {
      if (job.state === "disabled") throw new ScheduledJobError("invalid", "A Scheduled Job for a removed Project cannot resume")
      return { ...job, state, pending: false, ...(state === "active" && job.nextRunAt === undefined ? { nextRunAt: this.#now().toISOString() } : {}), updatedAt: this.#now().toISOString(), ...(actor === undefined ? {} : { updatedBy: actor }) }
    })
  }
  async delete(id: string): Promise<void> {
    let found = false
    await this.#store.update({ version: 1, jobs: [] }, (data) => ({ version: 1, jobs: data.jobs.filter((job) => { if (job.id === id) { found = true; return false }; return true }) }))
    if (!found) throw new ScheduledJobError("not-found", "Scheduled Job not found")
  }
  async disableProject(projectId: string): Promise<void> {
    await this.#store.update({ version: 1, jobs: [] }, (data) => ({ version: 1, jobs: data.jobs.map((job) => {
      if (job.projectId !== projectId) return job
      const retained = withoutNextRun(job)
      return { ...retained, state: "disabled" as const, pending: false, updatedAt: this.#now().toISOString() }
    }) }))
  }
  record(id: string, run: ScheduledRun, nextRunAt?: string, pending = false, completeSchedule = true): Promise<ScheduledJob> {
    return this.#change(id, (job) => {
      const retained = withoutNextRun(job)
      return { ...retained, history: [...job.history, run].slice(-HISTORY_LIMIT), pending, ...(nextRunAt === undefined ? {} : { nextRunAt }), updatedAt: this.#now().toISOString(), ...(completeSchedule && job.schedule.type === "one-time" && run.status !== "deferred" ? { state: "paused" as const } : {}) }
    })
  }
  #change(id: string, change: (job: ScheduledJob) => ScheduledJob): Promise<ScheduledJob> {
    let result: ScheduledJob | undefined
    return this.#store.update({ version: 1, jobs: [] }, (data) => ({ version: 1, jobs: data.jobs.map((job) => job.id === id ? (result = change(job)) : job) })).then(() => { if (result === undefined) throw new ScheduledJobError("not-found", "Scheduled Job not found"); return result })
  }
}

export type ScheduledJobAgentAction = "list" | "get" | "create" | "update" | "pause" | "resume" | "delete" | "run-now"
export class ScheduledJobAgentBridge {
  #handler?: (action: ScheduledJobAgentAction, input: Record<string, unknown>) => Promise<unknown>
  bind(handler: (action: ScheduledJobAgentAction, input: Record<string, unknown>) => Promise<unknown>): void { this.#handler = handler }
  invoke(action: ScheduledJobAgentAction, input: Record<string, unknown>): Promise<unknown> {
    if (this.#handler === undefined) throw new Error("Scheduled Jobs service is unavailable")
    return this.#handler(action, input)
  }
}

export interface ScheduledTurnResult { readonly status: "started" | "busy" | "failed"; readonly sessionId?: string; readonly message?: string; readonly completion?: Promise<void> }
export class ScheduledJobScheduler {
  #timer?: NodeJS.Timeout
  #running = false
  constructor(readonly store: ScheduledJobStore, readonly startTurn: (job: ScheduledJob) => Promise<ScheduledTurnResult>, readonly now: () => Date = () => new Date(), readonly setTimer: (callback: () => void, ms: number) => NodeJS.Timeout = setTimeout, readonly clearTimer: (timer: NodeJS.Timeout) => void = clearTimeout) {}
  start(): void { void this.tick(); this.#timer = this.setTimer(() => this.start(), 30_000) }
  stop(): void { if (this.#timer !== undefined) this.clearTimer(this.#timer) }
  async tick(): Promise<void> {
    if (this.#running) return
    this.#running = true
    try { for (const job of await this.store.list()) if (job.state === "active" && job.nextRunAt !== undefined && Date.parse(job.nextRunAt) <= this.now().getTime()) await this.run(job, "schedule") } finally { this.#running = false }
  }
  async run(job: ScheduledJob, origin: "schedule" | "run-now"): Promise<ScheduledJob> {
    const attemptedAt = this.now().toISOString()
    const result = await this.startTurn(job)
    const recurringNext = origin === "run-now" ? job.nextRunAt : job.schedule.type === "recurring" ? nextOccurrence(job.schedule, this.now()).toISOString() : undefined
    if (result.status === "busy") return this.store.record(job.id, { id: randomUUID(), scheduledAt: job.nextRunAt ?? attemptedAt, attemptedAt, completedAt: this.now().toISOString(), status: "deferred", origin, message: result.message ?? "Fixed Session is busy" }, new Date(this.now().getTime() + RETRY_MS).toISOString(), true)
    let status: "succeeded" | "failed" = result.status === "failed" ? "failed" : "succeeded"
    let message = result.message
    if (result.status === "started") try { await result.completion } catch (error) { status = "failed"; message = error instanceof Error ? error.message : "Scheduled turn failed" }
    return this.store.record(job.id, { id: randomUUID(), scheduledAt: job.nextRunAt ?? attemptedAt, attemptedAt, completedAt: this.now().toISOString(), status, origin, ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }), ...(message === undefined ? {} : { message }) }, recurringNext, false, origin === "schedule")
  }
}

function withoutNextRun(job: ScheduledJob): Omit<ScheduledJob, "nextRunAt"> {
  const copy = { ...job } as ScheduledJob & { nextRunAt?: string }
  delete copy.nextRunAt
  return copy
}

function scheduleFirst(schedule: ScheduledJobMutation["schedule"], timezone: string, now: Date): Date {
  if (schedule.type === "one-time") { const date = localToUtc(schedule.localDateTime, timezone); if (date <= now) throw new ScheduledJobError("invalid", "One-time schedule must be in the future"); return date }
  if (schedule.frequency === "interval") {
    if (!validInterval(schedule.interval, schedule.intervalUnit)) throw new ScheduledJobError("invalid", "Recurrence must be at least 15 minutes and within supported bounds")
    if (schedule.localStart !== undefined) { const start = localToUtc(schedule.localStart, timezone); if (start > now) return start; return nextFlexibleInterval({ ...schedule, timezone, anchorUtc: start.toISOString() }, now) }
    if (schedule.intervalUnit === "minute" || schedule.intervalUnit === "hour") return new Date(now.getTime() + intervalMilliseconds(schedule))
    const local = localDateTimeParts(now, timezone)
    const anchor = localToUtc(formatLocal(local), timezone)
    return nextFlexibleInterval({ ...schedule, timezone, anchorUtc: anchor.toISOString() }, now)
  }
  return nextCalendarOccurrence(schedule, timezone, now)
}
function normalizeSchedule(schedule: ScheduledJobMutation["schedule"], timezone: string, now: Date): ScheduledJob["schedule"] {
  const first = scheduleFirst(schedule, timezone, now).toISOString()
  if (schedule.type === "one-time") return { type: "one-time", runAtUtc: first, timezone }
  const anchorUtc = schedule.frequency === "interval" && schedule.localStart !== undefined ? localToUtc(schedule.localStart, timezone).toISOString() : first
  return { ...schedule, timezone, anchorUtc }
}
export function nextOccurrence(schedule: Extract<ScheduledJob["schedule"], { type: "recurring" }>, now: Date): Date {
  if (schedule.frequency === "interval") {
    if ("intervalMinutes" in schedule) { const start=Date.parse(schedule.anchorUtc), duration=schedule.intervalMinutes*60_000; return new Date(start > now.getTime() ? start : start + (Math.floor((now.getTime()-start)/duration)+1)*duration) }
    return nextFlexibleInterval(schedule, now)
  }
  return nextCalendarOccurrence(schedule, schedule.timezone, now)
}
function nextFlexibleInterval(schedule: IntervalRecurrence & { readonly timezone: string; readonly anchorUtc: string }, now: Date): Date {
  const start = Date.parse(schedule.anchorUtc)
  if (start > now.getTime()) return new Date(start)
  if (schedule.intervalUnit === "minute" || schedule.intervalUnit === "hour") {
    const duration=intervalMilliseconds(schedule)
    return new Date(start+(Math.floor((now.getTime()-start)/duration)+1)*duration)
  }
  const anchor=localDateTimeParts(new Date(start), schedule.timezone)
  for (let occurrence=1; occurrence<=1_000_000; occurrence+=1) {
    const candidate=calendarCandidate(anchor, schedule.interval*occurrence, schedule.intervalUnit, schedule.timezone)
    if (candidate > now) return candidate
  }
  throw new ScheduledJobError("invalid", "Could not calculate the next recurrence")
}
function intervalMilliseconds(schedule: Pick<IntervalRecurrence, "interval"|"intervalUnit">): number { return intervalMinutes(schedule.interval, schedule.intervalUnit)*60_000 }
function calendarCandidate(anchor: LocalDateTimeParts, amount: number, unit: Exclude<IntervalUnit,"minute"|"hour">, timezone: string): Date {
  let year=anchor.year, month=anchor.month, day=anchor.day
  if (unit === "day" || unit === "week") { const date=new Date(Date.UTC(year,month-1,day+amount*(unit === "week" ? 7 : 1))); year=date.getUTCFullYear(); month=date.getUTCMonth()+1; day=date.getUTCDate() }
  else { const total=year*12+(month-1)+amount*(unit === "year" ? 12 : 1); year=Math.floor(total/12); month=total%12+1; day=Math.min(day,daysInMonth(year,month)) }
  return localToUtc(formatLocal({ ...anchor, year, month, day }), timezone)
}
function nextCalendarOccurrence(schedule: Exclude<Recurrence, { frequency: "interval" }>, timezone: string, now: Date): Date {
  const local = localParts(now, timezone)
  for (let add=0; add<=370; add+=1) { const date=new Date(Date.UTC(local.year,local.month-1,local.day+add)); const year=date.getUTCFullYear(),month=date.getUTCMonth()+1,day=date.getUTCDate(),weekday=date.getUTCDay(); if(schedule.frequency==="weekly"&&!schedule.weekdays.includes(weekday))continue; if(schedule.frequency==="monthly"&&day!==Math.min(schedule.day,daysInMonth(year,month)))continue; const candidate=localToUtc(`${year.toString().padStart(4,"0")}-${month.toString().padStart(2,"0")}-${day.toString().padStart(2,"0")}T${schedule.localTime}`,timezone); if(candidate>now)return candidate }
  throw new ScheduledJobError("invalid", "Could not calculate the next recurrence")
}
type LocalDateTimeParts={year:number;month:number;day:number;hour:number;minute:number;second:number}
function localDateTimeParts(date: Date, timezone: string): LocalDateTimeParts { const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).map((part)=>[part.type,part.value])); return {year:+parts.year!,month:+parts.month!,day:+parts.day!,hour:+parts.hour!,minute:+parts.minute!,second:+parts.second!} }
function formatLocal(value: LocalDateTimeParts): string { return `${String(value.year).padStart(4,"0")}-${String(value.month).padStart(2,"0")}-${String(value.day).padStart(2,"0")}T${String(value.hour).padStart(2,"0")}:${String(value.minute).padStart(2,"0")}:${String(value.second).padStart(2,"0")}` }
function daysInMonth(year:number,month:number):number{return new Date(Date.UTC(year,month,0)).getUTCDate()}
function localParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]))
  return { year: +parts.year!, month: +parts.month!, day: +parts.day! }
}
export function localToUtc(value: string, timezone: string): Date {
  if (!isIanaTimezone(timezone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)) throw new ScheduledJobError("invalid", "Local date and time is invalid")
  const [date, time] = value.split("T") as [string, string]
  const dateParts = date.split("-").map(Number), timeParts = time.split(":").map(Number)
  const year = dateParts[0]!, month = dateParts[1]!, day = dateParts[2]!, hour = timeParts[0]!, minute = timeParts[1]!, second = timeParts[2] ?? 0
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second)
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  const matches: Date[] = []
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(wanted - offset * 60_000)
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]))
    if (+parts.year! === year && +parts.month! === month && +parts.day! === day && +parts.hour! === hour && +parts.minute! === minute && +parts.second! === second) matches.push(candidate)
  }
  if (matches.length !== 1) throw new ScheduledJobError("invalid", matches.length === 0 ? "Local date and time does not exist in this timezone" : "Local date and time is ambiguous in this timezone")
  return matches[0]!
}
