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
  })
})
