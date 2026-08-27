import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import { relative, resolve } from "node:path"
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { MAX_TIMELINE_BYTES, MAX_TIMELINE_ITEMS, MAX_TIMELINE_ITEM_BYTES, type Project, type SavedSession, type SessionHistoryPage, type SessionKey, type TimelineItem } from "@pi-station/application-protocol"
import { PersistentSessionIndex } from "./session-index.js"
import { DELEGATION_REPORT_CUSTOM_TYPE, delegationReportDetails } from "./delegation-report.js"
import { projectActiveTimelineImage, timelineImages, type SavedTimelineImage } from "./session-images.js"
import { ATTACHMENT_CUSTOM_TYPE, stripAttachmentPromptSuffix } from "./session-attachments.js"

export type IndexedSession = Omit<SavedSession, "state"> & { readonly cwd?: string }
export interface SessionIndex {
  list(projects: readonly Project[]): Promise<readonly IndexedSession[]>
  get(key: SessionKey, projects: readonly Project[]): Promise<IndexedSession | undefined>
  indexSession(session: IndexedSession): Promise<IndexedSession>
  refreshSession(key: SessionKey, project: Project): Promise<IndexedSession | undefined>
  timeline(session: IndexedSession): Promise<readonly TimelineItem[]>
  historyPage(session: IndexedSession, before?: string): Promise<SessionHistoryPage>
  timelineImage(session: IndexedSession, imageId: string): Promise<SavedTimelineImage | undefined>
  rename(session: IndexedSession, name: string): Promise<IndexedSession>
}

function text(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value.flatMap((part) => {
    if (typeof part !== "object" || part === null) return []
    const record = part as Record<string, unknown>
    return record.type === "text" && typeof record.text === "string" ? [record.text] : []
  }).join("\n")
}

function boundedTimelineText(value: string): string {
  const maxTextBytes = Math.floor(MAX_TIMELINE_ITEM_BYTES / 8)
  if (Buffer.byteLength(value) <= maxTextBytes) return value
  return `${Buffer.from(value).subarray(0, maxTextBytes).toString("utf8")}\n[truncated]`
}

function scheduledJobDetails(value: unknown): { readonly jobId: string; readonly title: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const details = value as Record<string, unknown>
  return details.kind === "scheduled-job" && typeof details.jobId === "string" && details.jobId !== "" && typeof details.title === "string" && details.title !== ""
    ? { jobId: details.jobId, title: details.title }
    : undefined
}

function agentMessageDetails(value: unknown): { readonly fromSessionId: string; readonly fromName?: string; readonly message?: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const details = value as Record<string, unknown>
  if (details.kind !== "agent-message" || typeof details.fromSessionId !== "string" || details.fromSessionId === "") return undefined
  return {
    fromSessionId: details.fromSessionId,
    ...(typeof details.fromName === "string" && details.fromName !== "" ? { fromName: details.fromName } : {}),
    ...(typeof details.message === "string" ? { message: details.message } : {}),
  }
}

function normalizedActiveTimeline(entries: readonly SessionEntry[]): readonly TimelineItem[] {
  const timeline: TimelineItem[] = []
  let pendingAttachments: Array<{ id: string; name: string; mediaType: string; size: number }> | undefined
  const toolCalls = new Map<string, number>()
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      timeline.push({
        id: entry.id,
        kind: "context-summary",
        summaryType: entry.type === "compaction" ? "compaction" : "branch",
        text: entry.summary,
        timestamp: entry.timestamp,
      })
      continue
    }
    if (entry.type === "custom_message" && entry.customType === ATTACHMENT_CUSTOM_TYPE) {
      const details = entry.details as { attachments?: unknown } | undefined
      if (Array.isArray(details?.attachments)) pendingAttachments = details.attachments.flatMap((value) => {
        if (typeof value !== "object" || value === null) return []
        const file = value as Record<string, unknown>
        return typeof file.id === "string" && typeof file.name === "string" && typeof file.mediaType === "string" && typeof file.size === "number"
          ? [{ id: file.id, name: file.name.slice(0, 200), mediaType: file.mediaType.slice(0, 100), size: file.size }] : []
      }).slice(0, 4)
      continue
    }
    if (entry.type === "custom_message" && entry.display) {
      const agentMessage = entry.customType === "pi-station-agent-message" ? agentMessageDetails(entry.details) : undefined
      if (agentMessage !== undefined) {
        const { message, ...sender } = agentMessage
        timeline.push({ id: entry.id, kind: "agent", ...sender, text: message ?? text(entry.content), timestamp: entry.timestamp })
        continue
      }
      const nextEntry = entries[entryIndex + 1]
      const job = entry.customType === "pi-station-scheduled-job" ? scheduledJobDetails(entry.details) : undefined
      if (job !== undefined && nextEntry?.type === "message") {
        const nextMessage = nextEntry.message as unknown as Record<string, unknown>
        if (nextMessage.role === "user") {
          timeline.push({ id: entry.id, kind: "scheduled-job", jobId: job.jobId, title: job.title, text: text(nextMessage.content), timestamp: entry.timestamp })
          entryIndex += 1
          continue
        }
      }
      const report = entry.customType === DELEGATION_REPORT_CUSTOM_TYPE
        ? delegationReportDetails(entry.details)
        : undefined
      timeline.push(report === undefined
        ? { id: entry.id, kind: "system", text: text(entry.content), timestamp: entry.timestamp }
        : { id: entry.id, kind: "tool", title: `${report.toolName} · ${report.status}`, text: text(entry.content), state: "succeeded", timestamp: entry.timestamp })
      continue
    }
    if (entry.type !== "message") continue
    const message = entry.message as unknown as Record<string, unknown>
    if (message.role === "user") {
      const images = timelineImages(entry.id, message.content)
      const messageText = text(message.content)
      timeline.push({ id: entry.id, kind: "user", text: pendingAttachments === undefined ? messageText : stripAttachmentPromptSuffix(messageText), ...(images.length === 0 ? {} : { images }), ...(pendingAttachments === undefined || pendingAttachments.length === 0 ? {} : { attachments: pendingAttachments }), timestamp: entry.timestamp })
      pendingAttachments = undefined
      continue
    }
    if (message.role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : []
      for (const [index, part] of content.entries()) {
        if (typeof part !== "object" || part === null) continue
        const item = part as Record<string, unknown>
        if (item.type === "text" && typeof item.text === "string") timeline.push({ id: `${entry.id}:${index}`, kind: "assistant", text: item.text, timestamp: entry.timestamp })
        else if (item.type === "thinking" && typeof item.thinking === "string") timeline.push({ id: `${entry.id}:${index}`, kind: "thinking", text: item.thinking, timestamp: entry.timestamp })
        else if (item.type === "toolCall") {
          const toolCallId = typeof item.id === "string" ? item.id : `${entry.id}:${index}`
          toolCalls.set(toolCallId, timeline.length)
          timeline.push({
            id: `tool-call-${toolCallId}`,
            kind: "tool",
            toolCallId,
            title: typeof item.name === "string" ? item.name : "Tool",
            inputText: typeof item.arguments === "object" ? JSON.stringify(item.arguments) : "",
            text: "",
            state: "running",
            timestamp: entry.timestamp,
          })
        }
      }
      continue
    }
    if (message.role === "toolResult") {
      const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined
      const callIndex = toolCallId === undefined ? undefined : toolCalls.get(toolCallId)
      if (callIndex !== undefined) {
        const call = timeline[callIndex]
        if (call?.kind === "tool") timeline[callIndex] = {
          ...call,
          text: text(message.content),
          state: message.isError === true ? "failed" : "succeeded",
        }
      } else {
        timeline.push({ id: entry.id, kind: "tool", title: typeof message.toolName === "string" ? message.toolName : "Tool result", text: text(message.content), ...(toolCallId === undefined ? {} : { toolCallId }), state: message.isError === true ? "failed" : "succeeded", timestamp: entry.timestamp })
      }
      continue
    }
    if (message.role === "bashExecution") timeline.push({ id: entry.id, kind: "tool", title: "Shell", text: typeof message.output === "string" ? message.output : "", state: "succeeded", timestamp: entry.timestamp })
  }
  return timeline.map((item) => item.kind === "tool"
    ? { ...item, title: boundedTimelineText(item.title), text: boundedTimelineText(item.text), ...(item.inputText === undefined ? {} : { inputText: boundedTimelineText(item.inputText) }) }
    : item.kind === "scheduled-job"
      ? { ...item, title: boundedTimelineText(item.title), text: boundedTimelineText(item.text) }
      : { ...item, text: boundedTimelineText(item.text) })
}

interface HistoryCursor { readonly v: 1; readonly revision: string; readonly beforeId: string }

function historyRevision(timeline: readonly TimelineItem[]): string {
  return createHash("sha256").update(JSON.stringify(timeline)).digest("base64url")
}

function encodeHistoryCursor(value: HistoryCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function decodeHistoryCursor(value: string): HistoryCursor | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return undefined
    const record = decoded as Record<string, unknown>
    if (Object.keys(record).length !== 3 || record.v !== 1 || typeof record.revision !== "string" || typeof record.beforeId !== "string") return undefined
    return { v: 1, revision: record.revision, beforeId: record.beforeId }
  } catch {
    return undefined
  }
}

export class StaleHistoryCursorError extends Error {}

export function projectActiveHistory(entries: readonly SessionEntry[], before?: string): SessionHistoryPage {
  const all = normalizedActiveTimeline(entries)
  const revision = historyRevision(all)
  let end = all.length
  if (before !== undefined) {
    const cursor = decodeHistoryCursor(before)
    if (cursor === undefined || cursor.revision !== revision) throw new StaleHistoryCursorError("History cursor is stale")
    end = all.findIndex(({ id }) => id === cursor.beforeId)
    if (end < 0) throw new StaleHistoryCursorError("History cursor is stale")
  }
  const selected: TimelineItem[] = []
  let bytes = 2
  for (let index = end - 1; index >= 0 && selected.length < MAX_TIMELINE_ITEMS; index -= 1) {
    const item = all[index]!
    const itemBytes = Buffer.byteLength(JSON.stringify(item)) + (selected.length === 0 ? 0 : 1)
    if (bytes + itemBytes > MAX_TIMELINE_BYTES) break
    selected.unshift(item)
    bytes += itemBytes
  }
  const start = end - selected.length
  const hasEarlier = start > 0
  return {
    version: 2,
    revision,
    ...(hasEarlier && selected[0] !== undefined
      ? { before: encodeHistoryCursor({ v: 1, revision, beforeId: selected[0].id }) }
      : {}),
    hasEarlier,
    timeline: selected,
  }
}

export function projectActiveTimeline(entries: readonly SessionEntry[]): readonly TimelineItem[] {
  return projectActiveHistory(entries).timeline
}

export class PublicSessionIndex implements SessionIndex {
  readonly #persistent: PersistentSessionIndex

  constructor(dataDir: string) {
    const scan = async (project: Project): Promise<readonly IndexedSession[]> => {
      const sessions: SessionInfo[] = await SessionManager.list(project.root)
      return sessions.map((session) => indexedSession(project, session))
    }
    const scanAll = async (projects: readonly Project[]): Promise<readonly IndexedSession[]> => (
      (await SessionManager.listAll()).map((session) => {
        const project = deepestProject(session.cwd, projects)
        return indexedSession(project ?? { id: projectId(session.cwd), root: session.cwd }, session)
      })
    )
    this.#persistent = new PersistentSessionIndex(dataDir, {
      scan,
      scanAll,
      refresh: async (project, key, current) => {
        if (current === undefined) return (await scan(project)).find((session) => session.id === key.sessionId)
        try {
          const [metadata, manager] = await Promise.all([
            stat(current.path),
            Promise.resolve(SessionManager.open(current.path)),
          ])
          const name = manager.getSessionName()
          const refreshed = {
            ...current,
            modifiedAt: metadata.mtime.toISOString(),
          }
          if (name === undefined) delete refreshed.name
          else refreshed.name = name
          return refreshed
        } catch {
          return (await scanAll([project])).find((session) => session.id === key.sessionId && session.projectId === key.projectId)
        }
      },
    })
  }

  list(projects: readonly Project[]): Promise<readonly IndexedSession[]> {
    return this.#persistent.list(projects)
  }

  refresh(projects: readonly Project[]): Promise<void> {
    return this.#persistent.refresh(projects)
  }

  get(key: SessionKey, projects: readonly Project[]): Promise<IndexedSession | undefined> {
    return this.#persistent.get(key, projects)
  }

  indexSession(session: IndexedSession): Promise<IndexedSession> {
    return this.#persistent.indexSession(session)
  }

  refreshSession(key: SessionKey, project: Project): Promise<IndexedSession | undefined> {
    return this.#persistent.refreshSession(key, project)
  }

  timeline(session: IndexedSession): Promise<readonly TimelineItem[]> {
    const manager = SessionManager.open(session.path)
    return Promise.resolve(projectActiveHistory(manager.getBranch()).timeline)
  }

  historyPage(session: IndexedSession, before?: string): Promise<SessionHistoryPage> {
    const manager = SessionManager.open(session.path)
    return Promise.resolve(projectActiveHistory(manager.getBranch(), before))
  }

  timelineImage(session: IndexedSession, imageId: string): Promise<SavedTimelineImage | undefined> {
    const manager = SessionManager.open(session.path)
    return Promise.resolve(projectActiveTimelineImage(manager.getBranch(), imageId))
  }

  async rename(session: IndexedSession, name: string): Promise<IndexedSession> {
    const manager = SessionManager.open(session.path)
    manager.appendSessionInfo(name)
    return await this.#persistent.rename({ projectId: session.projectId, sessionId: session.id }, name)
      ?? { ...session, name }
  }
}

function indexedSession(project: Project, session: SessionInfo): IndexedSession {
  return {
    id: session.id,
    projectId: project.id,
    path: session.path,
    cwd: session.cwd,
    ...(session.name === undefined ? {} : { name: session.name }),
    modifiedAt: session.modified.toISOString(),
  }
}

function deepestProject(cwd: string, projects: readonly Project[]): Project | undefined {
  const directory = resolve(cwd)
  return projects
    .filter((project) => {
      const path = relative(resolve(project.root), directory)
      return path === "" || (!path.startsWith("..") && !path.startsWith("/"))
    })
    .sort((left, right) => resolve(right.root).length - resolve(left.root).length)[0]
}

export function projectId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16)
}
