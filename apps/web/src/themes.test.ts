// @vitest-environment jsdom
import { isSystemTheme } from "@pi-station/application-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stop: (() => void) | undefined;

beforeEach(() => {
  stop = undefined;
  vi.resetModules();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-appearance");
  document.documentElement.removeAttribute("data-theme-id");
  document.documentElement.removeAttribute("style");
  document.head.innerHTML = '<meta name="theme-color" content="#f8faf7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)">';
});

afterEach(() => stop?.());

describe("theme startup", () => {
  it("applies saved selections when the application module loads", async () => {
    const values = new Map([
      ["pi-station:appearance", "dark"],
      ["pi-station:dark-theme", "ristretto"],
    ]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn() });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

    const themes = await import("./themes");
    stop = themes.stopSystemThemeSync;

    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(document.documentElement.dataset.themeId).toBe("ristretto");
    expect([...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content)).toEqual(["#2c2525", "#2c2525"]);
  });

  it("keeps the Pi Station fallback when Omarchy is unavailable", async () => {
    const values = new Map([["pi-station:theme-source", "system"], ["pi-station:appearance", "dark"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn() });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ version: 2, available: false })));

    const themes = await import("./themes");
    stop = themes.stopSystemThemeSync;
    await vi.waitFor(() => expect(themes.readSystemTheme().available).toBe(false));

    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(document.documentElement.dataset.themeId).toBe("tri-palms");
  });

  it("rejects malformed system theme payloads", async () => {
    const values = new Map([["pi-station:theme-source", "system"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn() });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ version: 1, available: true, source: "omarchy", name: "Unsafe", appearance: "dark", colors: {} })));

    const themes = await import("./themes");
    stop = themes.stopSystemThemeSync;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(themes.readSystemTheme()).toEqual({ version: 2, available: false });
    expect(document.documentElement.dataset.themeId).toBe("palms");
  });

  it("uses an available Omarchy theme by default", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn() });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const response = {
      version: 2,
      available: true,
      source: "omarchy",
      name: "Lumon",
      appearance: "dark",
      colors: { background: "#16242d", foreground: "#d6e2ee", accent: "#8bc9eb", error: "#4d86b0", warning: "#6fa4c9", success: "#5e95bc" },
    };
    expect(isSystemTheme(response)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));

    const themes = await import("./themes");
    stop = themes.stopSystemThemeSync;
    expect(themes.readThemeSource()).toBe("system");
    await vi.waitFor(() => expect(themes.readSystemTheme().available).toBe(true));
    expect(document.documentElement.dataset.themeId).toBe("omarchy-system");

    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--theme-background")).toBe("#16242d");
    expect([...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content)).toEqual(["#16242d", "#16242d"]);
  });
});
