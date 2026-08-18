import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import type { TimelineImage } from "@pi-station/application-protocol"
import { isProtocolId, MAX_TIMELINE_IMAGE_ID_BYTES, MAX_TIMELINE_IMAGES } from "@pi-station/application-protocol"
import { MAX_IMAGE_BYTES, matchesImageSignature, type ImageMediaType } from "./image-uploads.js"

const MAX_CONTENT_PART_INDEX = 1_000
const MAX_BASE64_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

export interface SavedTimelineImage {
  readonly mediaType: ImageMediaType
  readonly data: Buffer
}

export function timelineImages(entryId: string, content: unknown): readonly TimelineImage[] {
  if (!Array.isArray(content)) return []
  const images: TimelineImage[] = []
  for (const [partIndex, value] of content.entries()) {
    const part = asRecord(value)
    if (part?.type !== "image") continue
    if (images.length >= MAX_TIMELINE_IMAGES) break
    const mediaType = imageType(part.mimeType)
    const data = part.data
    const id = imageId(entryId, partIndex)
    images.push(
      mediaType !== undefined && id !== undefined && typeof data === "string" && isBoundedBase64(data)
        ? { id, mediaType, status: "available" }
        : { status: "unavailable" },
    )
  }
  return images
}

export function projectActiveTimelineImage(
  entries: readonly SessionEntry[],
  id: string,
): SavedTimelineImage | undefined {
  const locator = imageLocator(id)
  if (locator === undefined) return undefined
  const entry = entries.find((value) => value.id === locator.entryId)
  if (entry?.type !== "message") return undefined
  const message = asRecord(entry.message)
  if (message?.role !== "user" || !Array.isArray(message.content)) return undefined
  const part = asRecord(message.content[locator.partIndex])
  if (part?.type !== "image") return undefined
  const mediaType = imageType(part.mimeType)
  if (mediaType === undefined || typeof part.data !== "string" || !isBoundedBase64(part.data)) return undefined
  const data = Buffer.from(part.data, "base64")
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES || !matchesImageSignature(data, mediaType)) return undefined
  return { mediaType, data }
}

function imageId(entryId: string, partIndex: number): string | undefined {
  if (!isProtocolId(entryId) || partIndex > MAX_CONTENT_PART_INDEX) return undefined
  const id = Buffer.from(`${partIndex}:${entryId}`, "utf8").toString("base64url")
  return Buffer.byteLength(id, "utf8") <= MAX_TIMELINE_IMAGE_ID_BYTES ? id : undefined
}

function imageLocator(id: string): { readonly entryId: string; readonly partIndex: number } | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(id) || Buffer.byteLength(id, "utf8") > MAX_TIMELINE_IMAGE_ID_BYTES) return undefined
  let decoded: string
  try {
    decoded = Buffer.from(id, "base64url").toString("utf8")
  } catch {
    return undefined
  }
  if (Buffer.from(decoded, "utf8").toString("base64url") !== id) return undefined
  const separator = decoded.indexOf(":")
  if (separator < 1) return undefined
  const indexText = decoded.slice(0, separator)
  const entryId = decoded.slice(separator + 1)
  if (!/^(?:0|[1-9]\d*)$/u.test(indexText) || !isProtocolId(entryId)) return undefined
  const partIndex = Number(indexText)
  if (!Number.isSafeInteger(partIndex) || partIndex > MAX_CONTENT_PART_INDEX) return undefined
  return { entryId, partIndex }
}

function isBoundedBase64(value: string): boolean {
  if (value.length === 0 || value.length > MAX_BASE64_BYTES || value.length % 4 !== 0) return false
  if (!BASE64.test(value)) return false
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  return (value.length / 4) * 3 - padding <= MAX_IMAGE_BYTES
}

function imageType(value: unknown): ImageMediaType | undefined {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp" ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
