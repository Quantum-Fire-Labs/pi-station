import { PROTOCOL_VERSION } from "./version.js"

export interface SystemThemeColors {
  readonly background: string
  readonly foreground: string
  readonly accent: string
  readonly error: string
  readonly warning: string
  readonly success: string
}

export type SystemTheme =
  | { readonly version: typeof PROTOCOL_VERSION; readonly available: false }
  | { readonly version: typeof PROTOCOL_VERSION; readonly available: true; readonly source: "omarchy"; readonly name: string; readonly appearance: "light" | "dark"; readonly colors: SystemThemeColors }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u

export function isSystemTheme(value: unknown): value is SystemTheme {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version !== PROTOCOL_VERSION || typeof record.available !== "boolean") return false
  if (!record.available) return Object.keys(record).length === 2
  if (Object.keys(record).some((key) => !["version", "available", "source", "name", "appearance", "colors"].includes(key))) return false
  if (record.source !== "omarchy" || typeof record.name !== "string" || record.name.length === 0 || record.name.length > 120) return false
  if (record.appearance !== "light" && record.appearance !== "dark") return false
  if (typeof record.colors !== "object" || record.colors === null || Array.isArray(record.colors)) return false
  const colors = record.colors as Record<string, unknown>
  const keys = ["background", "foreground", "accent", "error", "warning", "success"]
  return Object.keys(colors).length === keys.length && keys.every((key) => typeof colors[key] === "string" && HEX_COLOR.test(colors[key]))
}
