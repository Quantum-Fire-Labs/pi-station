export interface MessageStashFile {
  readonly id: string
  readonly name: string
  readonly mediaType: string
  readonly size: number
}

export interface MessageStash {
  readonly id: string
  readonly text: string
  readonly createdAt: string
  readonly images: readonly MessageStashFile[]
  readonly attachments: readonly MessageStashFile[]
}

export interface CreateMessageStashRequest {
  readonly text: string
  readonly imageIds?: readonly string[]
  readonly attachmentIds?: readonly string[]
}

export function isCreateMessageStashRequest(value: unknown): value is CreateMessageStashRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !["text", "imageIds", "attachmentIds"].includes(key))) return false
  if (typeof record.text !== "string" || record.text.length > 100_000) return false
  const validIds = (ids: unknown): boolean => ids === undefined || (Array.isArray(ids) && ids.length <= 4 && ids.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(id)))
  if (!validIds(record.imageIds) || !validIds(record.attachmentIds)) return false
  const count = (Array.isArray(record.imageIds) ? record.imageIds.length : 0) + (Array.isArray(record.attachmentIds) ? record.attachmentIds.length : 0)
  return count <= 4 && (record.text.trim().length > 0 || count > 0)
}
