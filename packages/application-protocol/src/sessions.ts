import type { TimelineItem } from "./timeline.js"

export type SessionState = "open" | "closed"
export type SessionPhase = "idle" | "working"
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export interface ModelChoice {
  readonly provider: string
  readonly modelId: string
  readonly displayName?: string
}

export interface SessionSettings {
  readonly model?: ModelChoice
  readonly modelInventory: readonly ModelChoice[]
  readonly thinkingLevel?: ThinkingLevel
  readonly supportedThinkingLevels: readonly ThinkingLevel[]
}

export interface SessionKey {
  readonly projectId: string
  readonly sessionId: string
}

export interface SessionUnreadState {
  readonly hasUnread: boolean
  readonly latestAttentionId?: string
}

export interface SharedFileInfo {
  readonly name: string
  readonly url: string
  readonly size: number
  readonly modifiedAt: number
}

export interface SavedSession {
  readonly id: string
  readonly projectId: string
  readonly path: string
  /** Working directory retained for Sessions outside a configured Project. */
  readonly cwd?: string
  readonly name?: string
  readonly parentSessionId?: string
  readonly delegationStatus?: "working" | "completed" | "failed" | "cancelled" | "interrupted"
  /** True only for the host singleton scratch Session. */
  readonly quickSession?: true
  readonly quickSessionPending?: "clear" | "keep"
  readonly unread?: SessionUnreadState
  readonly modifiedAt: string
  readonly state: SessionState
  /** An in-memory move request that will apply when the current turn is idle. */
  readonly pendingProjectMove?: { readonly projectId: string; readonly projectName: string }
}

export interface SessionUpdatedEvent {
  readonly version: 2
  readonly type: "session.updated"
  readonly session: SavedSession
}

export interface SessionPhaseSummary extends SessionKey {
  readonly phase: SessionPhase
  readonly epoch: string
  readonly generation: number
}

export interface SessionPhaseUpdatedEvent {
  readonly version: 2
  readonly type: "session.phase"
  readonly session: SessionPhaseSummary
}

export interface SessionHistoryPage {
  readonly version: 2
  /** Changes whenever the authoritative active JSONL branch changes. */
  readonly revision: string
  /** Opaque boundary for the next earlier page. */
  readonly before?: string
  readonly hasEarlier: boolean
  readonly timeline: readonly TimelineItem[]
}

export interface SessionView {
  readonly version: 2
  /** Journal cursor captured before the authoritative JSONL view was read. */
  readonly eventCursor: number
  readonly session: SavedSession
  readonly phase: SessionPhase
  /** Opaque server-instance identity for phase ordering. Absent on older v2 servers. */
  readonly phaseEpoch?: string
  /** Monotonic ordering within phaseEpoch for this Session. Absent on older v2 servers. */
  readonly phaseGeneration?: number
  readonly timeline: readonly TimelineItem[]
  readonly historyRevision: string
  readonly historyBefore?: string
  readonly hasEarlierHistory: boolean
  readonly settings: SessionSettings
  readonly sharedFiles: readonly SharedFileInfo[]
  readonly commandApproval?: { readonly id: string; readonly command: string }
}

export interface SessionSharedFiles {
  readonly version: 2
  readonly sharedFiles: readonly SharedFileInfo[]
}

export function sessionKey(key: SessionKey): string {
  return `${key.projectId}:${key.sessionId}`
}

export function isSessionMoveRequest(value: unknown): value is { readonly projectId: string } {
  return isExactRecord(value, ["projectId"]) && typeof value.projectId === "string" && isProtocolId(value.projectId)
}

export function isSessionStateRequest(
  value: unknown,
): value is { readonly state: SessionState } {
  if (!isExactRecord(value, ["state"])) return false
  return value.state === "open" || value.state === "closed"
}

export function isModelSettingRequest(value: unknown): value is { readonly provider: string; readonly modelId: string } {
  if (!isExactRecord(value, ["provider", "modelId"])) return false
  return isSettingIdentifier(value.provider) && isSettingIdentifier(value.modelId)
}

export function isThinkingSettingRequest(value: unknown): value is { readonly level: ThinkingLevel } {
  if (!isExactRecord(value, ["level"])) return false
  return typeof value.level === "string" && (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).includes(value.level as ThinkingLevel)
}

function isSettingIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

export function isGeneratedSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isProtocolId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !value.includes("\0")
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.keys(value).every((key) => keys.includes(key))
}
