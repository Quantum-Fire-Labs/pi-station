import { join } from "node:path"
import type { ThinkingLevel } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

export interface SessionDefaults {
  readonly provider: string
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
}

export const DEFAULT_SESSION_DEFAULTS: SessionDefaults = {
  provider: "openai-codex",
  modelId: "gpt-5.6-sol",
  thinkingLevel: "medium",
}

const LEGACY_SESSION_DEFAULTS: Pick<SessionDefaults, "provider" | "modelId"> = {
  provider: "openai",
  modelId: "gpt-5.6-sol",
}

export function normalizeSessionDefaults(defaults: SessionDefaults): SessionDefaults {
  return defaults.provider === LEGACY_SESSION_DEFAULTS.provider
    && defaults.modelId === LEGACY_SESSION_DEFAULTS.modelId
    ? { ...defaults, provider: DEFAULT_SESSION_DEFAULTS.provider }
    : defaults
}

export function isSessionDefaults(value: unknown): value is SessionDefaults {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const defaults = value as Record<string, unknown>
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
  return Object.keys(defaults).length === 3
    && validIdentifier(defaults.provider)
    && validIdentifier(defaults.modelId)
    && typeof defaults.thinkingLevel === "string"
    && levels.includes(defaults.thinkingLevel)
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

export class SessionDefaultsStore {
  readonly #store: AtomicJsonStore<SessionDefaults>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "session-defaults.json"), isSessionDefaults)
  }

  async read(): Promise<SessionDefaults> {
    const stored = await this.#store.read(DEFAULT_SESSION_DEFAULTS)
    const normalized = normalizeSessionDefaults(stored)
    if (normalized !== stored) await this.#store.replace(normalized)
    return normalized
  }

  replace(defaults: SessionDefaults): Promise<SessionDefaults> {
    return this.#store.replace(normalizeSessionDefaults(defaults))
  }
}
