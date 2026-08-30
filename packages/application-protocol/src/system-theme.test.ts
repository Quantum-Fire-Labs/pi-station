import { describe, expect, it } from "vitest"
import { isSystemTheme } from "./system-theme.js"

describe("system theme protocol", () => {
  it("accepts unavailable and valid Omarchy responses", () => {
    expect(isSystemTheme({ version: 2, available: false })).toBe(true)
    expect(isSystemTheme({
      version: 2,
      available: true,
      source: "omarchy",
      name: "Lumon",
      appearance: "dark",
      colors: { background: "#16242d", foreground: "#d6e2ee", accent: "#8bc9eb", error: "#4d86b0", warning: "#6fa4c9", success: "#5e95bc" },
    })).toBe(true)
  })

  it("rejects invalid versions and colors", () => {
    expect(isSystemTheme({ version: 1, available: false })).toBe(false)
    expect(isSystemTheme({ version: 2, available: true, source: "omarchy", name: "Broken", appearance: "dark", colors: {} })).toBe(false)
    expect(isSystemTheme({ version: 2, available: true, source: "omarchy", name: "Broken", appearance: "dark", colors: { background: "#000000", foreground: "#ffffff", accent: "#7777ff", error: "#ff7777", warning: "#ffcc77", success: "#77cc77" }, style: { fontFamily: "Mono", baseFontSize: 14 } })).toBe(false)
  })

  it("accepts optional complete style metadata without breaking legacy payloads", () => {
    const theme = {
      version: 2,
      available: true,
      source: "omarchy",
      name: "Lumon",
      appearance: "dark",
      colors: { background: "#16242d", foreground: "#d6e2ee", accent: "#8bc9eb", error: "#4d86b0", warning: "#6fa4c9", success: "#5e95bc" },
      style: { fontFamily: "JetBrainsMono Nerd Font", baseFontSize: 14, cornerRadius: 3 },
    }
    expect(isSystemTheme(theme)).toBe(true)
    expect(isSystemTheme({ ...theme, style: { ...theme.style, cornerRadius: -1 } })).toBe(false)
  })
})
