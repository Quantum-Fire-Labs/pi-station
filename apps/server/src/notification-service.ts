import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import webPush from "web-push"
import type { SessionKey } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

const MAX_SUBSCRIPTIONS = 100
const MAX_PER_DEVICE = 10
const MAX_DELIVERIES = 2_000
const DELIVERY_RETENTION_MS = 7 * 86_400_000
const PRESENCE_TTL_MS = 45_000
const VAPID_SUBJECT = process.env.PI_STATION_VAPID_SUBJECT ?? "mailto:notifications@localhost"
export const MAX_NOTIFICATION_BODY_GRAPHEMES = 240
export const MAX_NOTIFICATION_BODY_BYTES = 960

type DeviceClass = "desktop" | "mobile"
interface SubscriptionRecord {
  readonly id: string
  readonly deviceId: string
  readonly endpoint: string
  readonly expirationTime: number | null
  readonly keys: { readonly p256dh: string; readonly auth: string }
  readonly deviceClass: DeviceClass
  readonly updatedAt: number
}
interface DeliveryRecord { readonly id: string; readonly createdAt: number }
interface NotificationState { readonly version: 1; readonly subscriptions: readonly SubscriptionRecord[]; readonly deliveries: readonly DeliveryRecord[] }
interface VapidKeys { readonly publicKey: string; readonly privateKey: string }
const EMPTY: NotificationState = { version: 1, subscriptions: [], deliveries: [] }

export interface NotificationAttention extends SessionKey {
  readonly id: string
  readonly kind: "completed" | "needs-attention"
  readonly sessionName?: string
  readonly text?: string
}

export interface NotificationPresence {
  readonly deviceId: string
  readonly desktopActive: boolean
  readonly visibleSession?: SessionKey
}

export interface NotificationPayload {
  readonly title: string
  readonly body: string
  readonly tag: string
  readonly data: { readonly hostId: string; readonly piSessionId: string }
}

export type PushSender = typeof webPush.sendNotification
export type NativeNotificationListener = (payload: NotificationPayload) => void

export class NotificationInputError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

export class NotificationRepository {
  readonly #store: AtomicJsonStore<NotificationState>
  readonly #now: () => number

  constructor(dataDir: string, now = Date.now) {
    this.#store = new AtomicJsonStore(join(dataDir, "notifications.json"), isNotificationState)
    this.#now = now
  }

  async upsert(deviceIdValue: unknown, input: unknown): Promise<{ created: boolean }> {
    const deviceId = validateDeviceId(deviceIdValue)
    const value = validateSubscription(input)
    let created = false
    await this.#store.update(EMPTY, (current) => {
      const prior = current.subscriptions.find((item) => item.endpoint === value.endpoint)
      if (prior !== undefined && prior.deviceId !== deviceId) throw new NotificationInputError(409, "subscription-owned-by-another-device")
      const deviceCount = current.subscriptions.filter((item) => item.deviceId === deviceId).length
      if (prior === undefined && (current.subscriptions.length >= MAX_SUBSCRIPTIONS || deviceCount >= MAX_PER_DEVICE)) {
        throw new NotificationInputError(409, "subscription-limit")
      }
      created = prior === undefined
      const record: SubscriptionRecord = { id: prior?.id ?? randomUUID(), deviceId, ...value, updatedAt: this.#now() }
      return { ...current, subscriptions: [record, ...current.subscriptions.filter((item) => item.endpoint !== value.endpoint)] }
    })
    return { created }
  }

  async remove(deviceIdValue: unknown, endpointValue: unknown): Promise<boolean> {
    const deviceId = validateDeviceId(deviceIdValue)
    const endpoint = validateEndpoint(endpointValue)
    let removed = false
    await this.#store.update(EMPTY, (current) => {
      const subscriptions = current.subscriptions.filter((item) => item.deviceId !== deviceId || item.endpoint !== endpoint)
      removed = subscriptions.length !== current.subscriptions.length
      return removed ? { ...current, subscriptions } : current
    })
    return removed
  }

  async list(): Promise<readonly SubscriptionRecord[]> {
    const now = this.#now()
    const state = await this.#store.update(EMPTY, (current) => {
      const subscriptions = current.subscriptions.filter((item) => item.expirationTime === null || item.expirationTime > now)
      return subscriptions.length === current.subscriptions.length ? current : { ...current, subscriptions }
    })
    return state.subscriptions
  }

  async removeIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const selected = new Set(ids)
    await this.#store.update(EMPTY, (current) => ({ ...current, subscriptions: current.subscriptions.filter((item) => !selected.has(item.id)) }))
  }

  async claim(id: string): Promise<boolean> {
    if (!validText(id, 500)) throw new Error("Notification attention ID is invalid")
    let claimed = false
    const now = this.#now()
    await this.#store.update(EMPTY, (current) => {
      const retained = current.deliveries.filter((item) => item.createdAt >= now - DELIVERY_RETENTION_MS)
      if (retained.some((item) => item.id === id)) {
        return retained.length === current.deliveries.length ? current : { ...current, deliveries: retained }
      }
      claimed = true
      return { ...current, deliveries: [{ id, createdAt: now }, ...retained].slice(0, MAX_DELIVERIES) }
    })
    return claimed
  }
}

export class NotificationPresenceStore {
  readonly #active = new Map<string, NotificationPresence & { readonly expiresAt: number }>()
  readonly #now: () => number

  constructor(now = Date.now) { this.#now = now }

  report(value: unknown): void {
    const presence = validatePresence(value)
    this.#active.set(presence.deviceId, { ...presence, expiresAt: this.#now() + PRESENCE_TTL_MS })
  }

  deliveryState(): { readonly suppressMobile: boolean; readonly visibleSessions: ReadonlyMap<string, SessionKey> } {
    const now = this.#now()
    const visibleSessions = new Map<string, SessionKey>()
    let suppressMobile = false
    for (const [deviceId, item] of this.#active) {
      if (item.expiresAt <= now) {
        this.#active.delete(deviceId)
        continue
      }
      if (item.desktopActive) suppressMobile = true
      if (item.visibleSession !== undefined) visibleSessions.set(deviceId, item.visibleSession)
    }
    return { suppressMobile, visibleSessions }
  }
}

export class NotificationService {
  readonly #dataDir: string
  readonly #repository: NotificationRepository
  readonly #presence: NotificationPresenceStore
  readonly #sender: PushSender
  readonly #nativeListeners = new Map<string, Set<NativeNotificationListener>>()
  #keys: VapidKeys | undefined
  #initialization: Promise<void> | undefined

  constructor(dataDir: string, repository: NotificationRepository, presence: NotificationPresenceStore, sender: PushSender = webPush.sendNotification) {
    this.#dataDir = dataDir
    this.#repository = repository
    this.#presence = presence
    this.#sender = sender
  }

  async capabilities(): Promise<{ readonly available: true; readonly publicKey: string }> {
    await this.#initialize()
    return { available: true, publicKey: this.#keys!.publicKey }
  }

  subscribeNative(deviceIdValue: unknown, listener: NativeNotificationListener): () => void {
    const deviceId = validateDeviceId(deviceIdValue)
    const listeners = this.#nativeListeners.get(deviceId) ?? new Set<NativeNotificationListener>()
    listeners.add(listener)
    this.#nativeListeners.set(deviceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#nativeListeners.delete(deviceId)
    }
  }

  async notify(attention: NotificationAttention): Promise<void> {
    try {
      if (!await this.#repository.claim(attention.id)) return
      await this.#initialize()
      const notification = notificationPayload(attention)
      const payload = JSON.stringify(notification)
      const delivery = this.#presence.deliveryState()
      for (const [deviceId, listeners] of this.#nativeListeners) {
        const visible = delivery.visibleSessions.get(deviceId)
        if (visible !== undefined && sameSession(visible, attention)) continue
        for (const listener of listeners) listener(notification)
      }
      const gone: string[] = []
      const subscriptions = (await this.#repository.list()).filter((item) => {
        if (delivery.suppressMobile && item.deviceClass === "mobile") return false
        const visible = delivery.visibleSessions.get(item.deviceId)
        return visible === undefined || !sameSession(visible, attention)
      })
      await Promise.all(subscriptions.map(async (item) => {
        try {
          await this.#sender({ endpoint: item.endpoint, expirationTime: item.expirationTime, keys: item.keys }, payload, {
            TTL: 300,
            urgency: "normal",
            vapidDetails: { subject: VAPID_SUBJECT, ...this.#keys! },
          })
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          console.error(JSON.stringify({ event: "pi-station.notification-delivery-failed", statusCode: status ?? null }))
          if (status === 404 || status === 410) gone.push(item.id)
        }
      }))
      await this.#repository.removeIds(gone)
    } catch (error) {
      console.error(JSON.stringify({ event: "pi-station.notification-failed", message: error instanceof Error ? error.message : "unknown" }))
    }
  }

  #initialize(): Promise<void> {
    this.#initialization ??= this.#loadKeys()
    return this.#initialization
  }

  async #loadKeys(): Promise<void> {
    await mkdir(this.#dataDir, { recursive: true, mode: 0o700 })
    const path = join(this.#dataDir, "vapid.json")
    try {
      this.#keys = validateVapidKeys(JSON.parse(await readFile(path, "utf8")))
      await chmod(path, 0o600)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const keys = webPush.generateVAPIDKeys()
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(keys), { mode: 0o600, flag: "wx" })
    await rename(temporary, path)
    await chmod(path, 0o600)
    this.#keys = keys
  }
}

export function notificationPayload(attention: NotificationAttention): NotificationPayload {
  const title = truncate(normalize(attention.sessionName ?? ""), 80, 320) || "Pi Station"
  const body = attention.kind === "completed"
    ? truncate(normalizeMarkdown(attention.text ?? ""), MAX_NOTIFICATION_BODY_GRAPHEMES, MAX_NOTIFICATION_BODY_BYTES) || "Response completed."
    : "This Session needs your attention."
  return {
    title,
    body,
    tag: `pi-station:${attention.id}`,
    data: { hostId: attention.projectId, piSessionId: attention.sessionId },
  }
}

export function normalizeMarkdown(value: string): string {
  return normalize(value
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(`+)(.*?)\1/gs, "$2")
    .replace(/(\*\*|__|~~)(.*?)\1/gs, "$2"))
}

function normalize(value: string): string { // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/gu, " ").trim()
}

export function truncate(value: string, maxGraphemes: number, maxBytes: number): string {
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), ({ segment }) => segment)
  const selected = parts.slice(0, maxGraphemes)
  if (selected.length === parts.length && Buffer.byteLength(selected.join("")) <= maxBytes) return selected.join("")
  while (selected.length >= maxGraphemes || Buffer.byteLength(`${selected.join("").trimEnd()}…`) > maxBytes) selected.pop()
  return selected.length === 0 ? "" : `${selected.join("").trimEnd()}…`
}

function validateSubscription(value: unknown): Omit<SubscriptionRecord, "id" | "deviceId" | "updatedAt"> {
  if (!isRecord(value) || !exactKeys(value, ["deviceClass", "endpoint", "keys"], ["expirationTime"])) throw new NotificationInputError(400, "invalid-subscription")
  if (!isRecord(value.keys) || !exactKeys(value.keys, ["auth", "p256dh"])) throw new NotificationInputError(400, "invalid-subscription")
  const endpoint = validateEndpoint(value.endpoint)
  const p256dh = validateKey(value.keys.p256dh, 65, true)
  const auth = validateKey(value.keys.auth, 16, false)
  if (value.deviceClass !== "desktop" && value.deviceClass !== "mobile") throw new NotificationInputError(400, "invalid-subscription")
  const expirationTime = value.expirationTime
  let normalizedExpiration: number | null = null
  if (expirationTime !== undefined && expirationTime !== null) {
    if (typeof expirationTime !== "number" || !Number.isFinite(expirationTime) || expirationTime <= Date.now()) throw new NotificationInputError(400, "invalid-subscription")
    normalizedExpiration = expirationTime
  }
  return { endpoint, keys: { p256dh, auth }, deviceClass: value.deviceClass, expirationTime: normalizedExpiration }
}

function validatePresence(value: unknown): NotificationPresence {
  if (!isRecord(value) || !exactKeys(value, ["desktopActive", "deviceId"], ["visibleSession"]) || typeof value.desktopActive !== "boolean") throw new NotificationInputError(400, "invalid-presence")
  const deviceId = validateDeviceId(value.deviceId)
  if (value.visibleSession === undefined) return { deviceId, desktopActive: value.desktopActive }
  if (!isRecord(value.visibleSession) || !exactKeys(value.visibleSession, ["projectId", "sessionId"]) || !validText(value.visibleSession.projectId, 200) || !validText(value.visibleSession.sessionId, 200)) throw new NotificationInputError(400, "invalid-presence")
  return { deviceId, desktopActive: value.desktopActive, visibleSession: { projectId: value.visibleSession.projectId, sessionId: value.visibleSession.sessionId } }
}

function validateDeviceId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new NotificationInputError(400, "invalid-device")
  return value
}

function validateEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) throw new NotificationInputError(400, "invalid-subscription")
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") throw new Error()
  } catch { throw new NotificationInputError(400, "invalid-subscription") }
  return value
}

function validateKey(value: unknown, bytes: number, publicKey: boolean): string {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new NotificationInputError(400, "invalid-subscription")
  const decoded = Buffer.from(value, "base64url")
  if (decoded.length !== bytes || (publicKey && decoded[0] !== 4)) throw new NotificationInputError(400, "invalid-subscription")
  return value
}

function validateVapidKeys(value: unknown): VapidKeys {
  if (!isRecord(value) || !exactKeys(value, ["privateKey", "publicKey"])) throw new Error("Invalid Pi Station VAPID key file")
  return { publicKey: validateStoredKey(value.publicKey, 65, true), privateKey: validateStoredKey(value.privateKey, 32, false) }
}

function validateStoredKey(value: unknown, bytes: number, publicKey: boolean): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid Pi Station VAPID key file")
  const decoded = Buffer.from(value, "base64url")
  if (decoded.length !== bytes || (publicKey && decoded[0] !== 4)) throw new Error("Invalid Pi Station VAPID key file")
  return value
}

function isNotificationState(value: unknown): value is NotificationState {
  return isRecord(value) && value.version === 1 && Array.isArray(value.subscriptions) && value.subscriptions.length <= MAX_SUBSCRIPTIONS
    && value.subscriptions.every(isSubscriptionRecord) && Array.isArray(value.deliveries) && value.deliveries.length <= MAX_DELIVERIES
    && value.deliveries.every((item) => isRecord(item) && exactKeys(item, ["createdAt", "id"]) && validText(item.id, 500) && typeof item.createdAt === "number" && Number.isSafeInteger(item.createdAt))
}

function isSubscriptionRecord(value: unknown): value is SubscriptionRecord {
  if (!isRecord(value) || !exactKeys(value, ["deviceClass", "deviceId", "endpoint", "expirationTime", "id", "keys", "updatedAt"])) return false
  try {
    validateDeviceId(value.deviceId)
    validateSubscription({ endpoint: value.endpoint, expirationTime: null, keys: value.keys, deviceClass: value.deviceClass })
  } catch { return false }
  const expirationTime = value.expirationTime
  return (expirationTime === null || (typeof expirationTime === "number" && Number.isFinite(expirationTime)))
    && validText(value.id, 200) && typeof value.updatedAt === "number" && Number.isSafeInteger(value.updatedAt)
}

function sameSession(left: SessionKey, right: SessionKey): boolean { return left.sessionId === right.sessionId }
function validText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0") }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
}
