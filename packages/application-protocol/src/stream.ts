import type { SessionPhase } from "./sessions.js"
import type { TimelineItem } from "./timeline.js"

export type StreamEvent =
  | { readonly version: 2; readonly type: "phase"; readonly phase: SessionPhase; readonly epoch?: string; readonly generation?: number }
  | { readonly version: 2; readonly type: "assistant.delta" | "thinking.delta"; readonly text: string }
  | { readonly version: 2; readonly type: "tool"; readonly toolCallId: string; readonly title: string; readonly inputText?: string; readonly outputText?: string; readonly state: "running" | "succeeded" | "failed" }
  | { readonly version: 2; readonly type: "timeline"; readonly timeline: readonly TimelineItem[] }
  | { readonly version: 2; readonly type: "command.approval"; readonly approval: ApprovalRequest | null }
  | { readonly version: 2; readonly type: "error"; readonly message: string }

export type ApprovalRequest =
  | { readonly id: string; readonly kind: "command"; readonly command: string }
  | { readonly id: string; readonly kind: "delegation"; readonly model: string; readonly thinkingLevel: string }

export interface JournalEvent {
  readonly id: number
  readonly event: StreamEvent
}

export function encodeSse(event: StreamEvent, id?: number): string {
  const idLine = id === undefined ? "" : `id: ${id}\n`
  return `${idLine}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
