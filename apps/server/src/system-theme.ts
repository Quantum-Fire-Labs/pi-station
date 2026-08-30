import { execFile } from "node:child_process"
import { watch, type FSWatcher } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { SystemTheme } from "@pi-station/application-protocol"

export type { SystemTheme } from "@pi-station/application-protocol"

const UNAVAILABLE: SystemTheme = { version: 2, available: false }
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u

type CommandRunner = (file: string, args: readonly string[]) => Promise<string>

interface OmarchyThemeOptions {
  readonly homeDir?: string
  readonly command?: CommandRunner
}

export class SystemThemeService {
  readonly #currentDir: string
  readonly #reader: (currentDir: string) => Promise<SystemTheme>
  readonly #listeners = new Set<(theme: SystemTheme) => void>()
  #watcher: FSWatcher | undefined
  #poll: NodeJS.Timeout
  #refresh: NodeJS.Timeout | undefined
  #generation = 0
  #disposed = false
  #snapshot = JSON.stringify(UNAVAILABLE)
  #theme: SystemTheme = UNAVAILABLE

  constructor(
    currentDir = join(homedir(), ".local", "state", "omarchy", "current"),
    pollIntervalMs = 5_000,
    reader: (currentDir: string) => Promise<SystemTheme> = readOmarchyTheme,
  ) {
    this.#currentDir = currentDir
    this.#reader = reader
    this.#poll = setInterval(() => { void this.#load() }, pollIntervalMs)
    this.#poll.unref()
    void this.#load()
  }

  async read(): Promise<SystemTheme> {
    await this.#load()
    return this.#theme
  }

  subscribe(listener: (theme: SystemTheme) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation += 1
    clearInterval(this.#poll)
    if (this.#refresh !== undefined) clearTimeout(this.#refresh)
    this.#watcher?.close()
    this.#watcher = undefined
    this.#listeners.clear()
  }

  async #load(): Promise<void> {
    if (this.#disposed) return
    const generation = ++this.#generation
    this.#ensureWatcher()
    const theme = await this.#reader(this.#currentDir)
    if (this.#disposed || generation !== this.#generation) return
    const snapshot = JSON.stringify(theme)
    if (snapshot === this.#snapshot) return
    this.#snapshot = snapshot
    this.#theme = theme
    for (const listener of this.#listeners) listener(theme)
  }

  #ensureWatcher(): void {
    if (this.#disposed || this.#watcher !== undefined) return
    try {
      this.#watcher = watch(this.#currentDir, () => {
        if (this.#disposed) return
        if (this.#refresh !== undefined) clearTimeout(this.#refresh)
        this.#refresh = setTimeout(() => { this.#refresh = undefined; void this.#load() }, 75)
      })
      this.#watcher.on("error", () => { this.#watcher?.close(); this.#watcher = undefined })
    } catch { /* Polling detects Omarchy if its state directory appears later. */ }
  }
}

export async function readOmarchyTheme(currentDir: string, options: OmarchyThemeOptions = {}): Promise<SystemTheme> {
  try {
    const command = options.command ?? runCommand
    const [nameValue, colorsValue, style] = await Promise.all([
      readFile(join(currentDir, "theme.name"), "utf8"),
      readFile(join(currentDir, "theme", "colors.toml"), "utf8"),
      readOmarchyStyle(currentDir, options.homeDir ?? homedir(), command),
    ])
    const values = parseTopLevelToml(colorsValue)
    const background = color(values, "background")
    const foreground = color(values, "foreground")
    const accent = color(values, "accent", "blue", "color4")
    const error = color(values, "red", "color1")
    const warning = color(values, "yellow", "color3")
    const success = color(values, "green", "color2")
    if ([background, foreground, accent, error, warning, success].some((value) => value === undefined)) return UNAVAILABLE
    const mode = values.mode
    const appearance = mode === "light" || mode === "dark" ? mode : appearanceFromBackground(background!)
    const name = nameValue.trim()
    if (name.length === 0 || name.length > 120) return UNAVAILABLE
    return {
      version: 2,
      available: true,
      source: "omarchy",
      name: name.split(/[-_]+/u).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
      appearance,
      colors: { background: background!, foreground: foreground!, accent: accent!, error: error!, warning: warning!, success: success! },
      ...(style === undefined ? {} : { style }),
    }
  } catch { return UNAVAILABLE }
}

async function readOmarchyStyle(currentDir: string, homeDir: string, command: CommandRunner): Promise<Extract<SystemTheme, { available: true }>["style"]> {
  try {
    const [generatedShell, userShell, fontFamily, cornerRadius] = await Promise.all([
      readFile(join(currentDir, "theme", "shell.toml"), "utf8"),
      readFile(join(homeDir, ".config", "omarchy", "shell.toml"), "utf8").catch(() => ""),
      command("fc-match", ["monospace", "--format=%{family[0]}"]).then((value) => value.trim()),
      readHyprlandRounding(command),
    ])
    const generatedSize = tomlSectionNumber(generatedShell, "font", "base-size")
    const userSize = tomlSectionNumber(userShell, "font", "base-size")
    const baseFontSize = userSize ?? generatedSize
    if (fontFamily.length === 0 || fontFamily.length > 200 || baseFontSize === undefined || baseFontSize < 8 || baseFontSize > 32 || cornerRadius < 0 || cornerRadius > 64) return undefined
    return { fontFamily, baseFontSize, cornerRadius }
  } catch { return undefined }
}

async function readHyprlandRounding(command: CommandRunner): Promise<number> {
  let output: string
  try { output = await command("hyprctl", ["-j", "getoption", "decoration:rounding"]) }
  catch { output = await command("hyprctl", ["-j", "-i", "0", "getoption", "decoration:rounding"]) }
  const value = (JSON.parse(output) as { int?: unknown }).int
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Hyprland returned invalid rounding")
  return value
}

function runCommand(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
      if (error !== null) reject(new Error(error.message, { cause: error }))
      else resolve(stdout)
    })
  })
}

function tomlSectionNumber(input: string, section: string, key: string): number | undefined {
  let active = false
  for (const line of input.split(/\r?\n/u)) {
    const sectionMatch = /^\s*\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/u.exec(line)
    if (sectionMatch !== null) { active = sectionMatch[1] === section; continue }
    if (!active) continue
    const valueMatch = /^\s*([A-Za-z0-9_-]+)\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*(?:#.*)?$/u.exec(line)
    if (valueMatch?.[1] === key) return Number(valueMatch[2])
  }
  return undefined
}

function parseTopLevelToml(input: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {}
  for (const line of input.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/u.exec(line)
    if (match !== null) values[match[1]!] = match[2]!
  }
  return values
}

function color(values: Readonly<Record<string, string>>, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = values[key]
    if (value !== undefined && HEX_COLOR.test(value)) return value.toLowerCase()
  }
  return undefined
}

function appearanceFromBackground(background: string): "light" | "dark" {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]! > 0.45 ? "light" : "dark"
}
