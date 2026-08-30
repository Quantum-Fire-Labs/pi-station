import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readOmarchyTheme, SystemThemeService, type SystemTheme } from "../system-theme.js"

const roots: string[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function currentTheme(name: string, colors: string): Promise<string> {
  const current = await mkdtemp(join(tmpdir(), "pi-station-system-theme-"))
  roots.push(current)
  await mkdir(join(current, "theme"))
  await writeFile(join(current, "theme.name"), `${name}\n`)
  await writeFile(join(current, "theme", "colors.toml"), colors)
  return current
}

const darkTheme: SystemTheme = {
  version: 2,
  available: true,
  source: "omarchy",
  name: "Dark",
  appearance: "dark",
  colors: { background: "#111111", foreground: "#eeeeee", accent: "#7777ff", error: "#ff7777", warning: "#ffcc77", success: "#77cc77" },
}

const lightTheme: SystemTheme = {
  version: 2,
  available: true,
  source: "omarchy",
  name: "Light",
  appearance: "light",
  colors: { background: "#ffffff", foreground: "#111111", accent: "#2255aa", error: "#aa2222", warning: "#996600", success: "#228844" },
}

describe("Omarchy system theme", () => {
  it("normalizes the active semantic palette", async () => {
    const current = await currentTheme("tokyo-night", `
mode = "dark"
background = "#1A1B26"
foreground = "#A9B1D6"
accent = "#7AA2F7"
red = "#F7768E"
yellow = "#E0AF68"
green = "#9ECE6A"
`)

    await expect(readOmarchyTheme(current)).resolves.toEqual({
      version: 2,
      available: true,
      source: "omarchy",
      name: "Tokyo Night",
      appearance: "dark",
      colors: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        accent: "#7aa2f7",
        error: "#f7768e",
        warning: "#e0af68",
        success: "#9ece6a",
      },
    })
  })

  it("merges Omarchy style metadata and falls back to the live Hyprland instance", async () => {
    const current = await currentTheme("styled", `
mode = "dark"
background = "#111111"
foreground = "#eeeeee"
accent = "#7777ff"
red = "#ff7777"
yellow = "#ffcc77"
green = "#77cc77"
`)
    await writeFile(join(current, "theme", "shell.toml"), "[font]\nbase-size = 12\n")
    const home = await mkdtemp(join(tmpdir(), "pi-station-system-theme-home-"))
    roots.push(home)
    await mkdir(join(home, ".config", "omarchy"), { recursive: true })
    await writeFile(join(home, ".config", "omarchy", "shell.toml"), "[font]\nbase-size = 14 # user override\n")
    const command = vi.fn((file: string, args: readonly string[]) => {
      if (file === "fc-match") return Promise.resolve("JetBrainsMono Nerd Font\n")
      if (!args.includes("-i")) return Promise.reject(new Error("No inherited Hyprland instance"))
      return Promise.resolve('{"option":"decoration:rounding","int":3,"set":true}')
    })

    const theme = await readOmarchyTheme(current, { homeDir: home, command })
    expect(theme.available && theme.style).toEqual({ fontFamily: "JetBrainsMono Nerd Font", baseFontSize: 14, cornerRadius: 3 })
    expect(command).toHaveBeenCalledWith("hyprctl", ["-j", "-i", "0", "getoption", "decoration:rounding"])
  })

  it("omits all style metadata when one source is unavailable", async () => {
    const current = await currentTheme("legacy-style", `
background = "#ffffff"
foreground = "#111111"
red = "#aa0000"
green = "#00aa00"
yellow = "#aa7700"
blue = "#0066cc"
`)
    const theme = await readOmarchyTheme(current, { command: () => Promise.reject(new Error("command unavailable")) })
    expect(theme.available).toBe(true)
    if (theme.available) expect(theme.style).toBeUndefined()
  })

  it("supports legacy terminal color aliases and infers appearance", async () => {
    const current = await currentTheme("legacy", `
background = "#ffffff"
foreground = "#111111"
color1 = "#aa0000"
color2 = "#00aa00"
color3 = "#aa7700"
color4 = "#0066cc"
`)

    const theme = await readOmarchyTheme(current)
    expect(theme.available).toBe(true)
    if (theme.available) expect(theme.appearance).toBe("light")
  })

  it("does not let an older concurrent read replace a newer theme", async () => {
    const current = await mkdtemp(join(tmpdir(), "pi-station-system-theme-race-"))
    roots.push(current)
    const pending: Array<(theme: SystemTheme) => void> = []
    const reader = () => new Promise<SystemTheme>((resolve) => pending.push(resolve))
    const service = new SystemThemeService(current, 60_000, reader)
    const latest = service.read()
    expect(pending).toHaveLength(2)

    pending[1]!(lightTheme)
    await expect(latest).resolves.toEqual(lightTheme)
    pending[0]!(darkTheme)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const final = service.read()
    pending[2]!(lightTheme)
    await expect(final).resolves.toEqual(lightTheme)
    service.dispose()
  })

  it("does not publish a read that completes after disposal", async () => {
    const current = await mkdtemp(join(tmpdir(), "pi-station-system-theme-dispose-"))
    roots.push(current)
    let resolveRead: ((theme: SystemTheme) => void) | undefined
    const service = new SystemThemeService(current, 60_000, () => new Promise<SystemTheme>((resolve) => { resolveRead = resolve }))
    const listener = vi.fn()
    service.subscribe(listener)
    service.dispose()
    resolveRead!(darkTheme)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listener).not.toHaveBeenCalled()
  })

  it("is unavailable when Omarchy is absent or its palette is invalid", async () => {
    const missing = await mkdtemp(join(tmpdir(), "pi-station-no-omarchy-"))
    roots.push(missing)
    await expect(readOmarchyTheme(missing)).resolves.toEqual({ version: 2, available: false })

    const invalid = await currentTheme("broken", `
mode = "dark"
background = "red"
foreground = "#ffffff"
accent = "#0000ff"
red = "#ff0000"
yellow = "#ffff00"
green = "#00ff00"
`)
    await expect(readOmarchyTheme(invalid)).resolves.toEqual({ version: 2, available: false })
  })
})
