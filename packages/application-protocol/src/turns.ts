export const MAX_PROMPT_IMAGES = 4
export const MAX_PROMPT_ATTACHMENTS = 4

export interface AgentMention {
  readonly sessionId: string
  readonly label: string
}

export interface PromptRequest {
  readonly prompt: string
  readonly imageIds?: readonly string[]
  readonly attachmentIds?: readonly string[]
  readonly agentMentions?: readonly AgentMention[]
}

export interface NewTurnRequest extends PromptRequest {
  readonly name?: string
  readonly cwd?: string
}

export function isPrompt(value: unknown): value is PromptRequest {
  const record = exactRecord(value, ["prompt", "imageIds", "attachmentIds", "agentMentions"])
  return record !== undefined
    && isValidPromptContent(record.prompt, record.imageIds, record.attachmentIds)
    && isAgentMentions(record.agentMentions)
}

export function isNewTurnRequest(value: unknown): value is NewTurnRequest {
  const record = exactRecord(value, ["prompt", "imageIds", "attachmentIds", "agentMentions", "name", "cwd"])
  return record !== undefined
    && isValidPromptContent(record.prompt, record.imageIds, record.attachmentIds)
    && isAgentMentions(record.agentMentions)
    && (record.name === undefined || isValidName(record.name))
    && (record.cwd === undefined || (typeof record.cwd === "string" && record.cwd.length > 0 && record.cwd.length <= 4_096))
}

function isValidPromptContent(prompt: unknown, imageIds: unknown, attachmentIds: unknown): boolean {
  if (typeof prompt !== "string" || prompt.length > 100_000) return false
  if (!isIds(imageIds, MAX_PROMPT_IMAGES) || !isIds(attachmentIds, MAX_PROMPT_ATTACHMENTS)) return false
  if ((Array.isArray(imageIds) ? imageIds.length : 0) + (Array.isArray(attachmentIds) ? attachmentIds.length : 0) > 4) return false
  return prompt.trim().length > 0 || (Array.isArray(imageIds) ? imageIds.length : 0) + (Array.isArray(attachmentIds) ? attachmentIds.length : 0) > 0
}

function isIds(value: unknown, maximum: number): value is readonly string[] | undefined {
  if (value === undefined) return true
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximum
    && value.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(id))
    && new Set(value).size === value.length
}

function isAgentMentions(value: unknown): value is readonly AgentMention[] | undefined {
  return value === undefined || (Array.isArray(value)
    && value.length > 0
    && value.length <= 20
    && value.every((mention) => {
      if (typeof mention !== "object" || mention === null || Array.isArray(mention)) return false
      const record = mention as Record<string, unknown>
      return Object.keys(record).every((key) => key === "sessionId" || key === "label")
        && typeof record.sessionId === "string" && record.sessionId.length > 0 && record.sessionId.length <= 200
        && typeof record.label === "string" && record.label.trim().length > 0 && record.label.length <= 400
    }))
}

function isValidName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 200
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return Object.keys(record).every((key) => keys.includes(key)) ? record : undefined
}
