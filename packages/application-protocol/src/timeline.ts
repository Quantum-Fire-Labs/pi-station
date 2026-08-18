export const MAX_TIMELINE_ITEMS = 50
export const MAX_TIMELINE_ITEM_BYTES = 64_000
export const MAX_TIMELINE_BYTES = 256_000
export const MAX_TIMELINE_IMAGES = 4
export const MAX_TIMELINE_IMAGE_ID_BYTES = 512

export type TimelineImage =
  | {
      readonly id: string
      readonly mediaType: "image/png" | "image/jpeg" | "image/webp"
      readonly status: "available"
    }
  | {
      readonly status: "unavailable"
    }

export interface TimelineAttachment {
  readonly id: string
  readonly name: string
  readonly mediaType: string
  readonly size: number
}

export type TimelineItem =
  | {
      readonly id: string
      readonly kind: "user"
      readonly text: string
      readonly images?: readonly TimelineImage[]
      readonly attachments?: readonly TimelineAttachment[]
      readonly timestamp?: string
    }
  | {
      readonly id: string
      readonly kind: "assistant" | "thinking" | "system"
      readonly text: string
      readonly timestamp?: string
    }
  | {
      readonly id: string
      readonly kind: "agent"
      readonly fromSessionId: string
      readonly fromName?: string
      readonly text: string
      readonly timestamp?: string
    }
  | {
      readonly id: string
      readonly kind: "scheduled-job"
      readonly jobId: string
      readonly title: string
      readonly text: string
      readonly timestamp?: string
    }
  | {
      readonly id: string
      readonly kind: "tool"
      readonly title: string
      readonly text: string
      readonly toolCallId?: string
      readonly inputText?: string
      readonly state?: "running" | "succeeded" | "failed"
      readonly timestamp?: string
    }

export function isTimelineImage(value: unknown): value is TimelineImage {
  if (!isRecord(value)) return false
  if (value.status === "unavailable") return Object.keys(value).length === 1
  return value.status === "available"
    && Object.keys(value).length === 3
    && typeof value.id === "string"
    && value.id.length > 0
    && new TextEncoder().encode(value.id).byteLength <= MAX_TIMELINE_IMAGE_ID_BYTES
    && /^[A-Za-z0-9_-]+$/u.test(value.id)
    && (value.mediaType === "image/png" || value.mediaType === "image/jpeg" || value.mediaType === "image/webp")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
