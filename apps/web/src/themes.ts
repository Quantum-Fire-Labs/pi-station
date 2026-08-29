import { isSystemTheme, type SystemTheme } from "@pi-station/application-protocol";

export type ThemeAppearance = "light" | "dark";
export type AppearancePreference = "system" | ThemeAppearance;
export type ThemeSource = "pi-station" | "system";
export type { SystemTheme } from "@pi-station/application-protocol";
export interface ThemeDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly appearance: ThemeAppearance;
  readonly colors: { readonly background: string; readonly foreground: string; readonly accent: string; readonly error: string; readonly warning: string; readonly success: string };
  readonly packaged?: boolean;
}

export const packagedThemes: readonly ThemeDefinition[] = [
  { schemaVersion: 1, id: "palms", name: "Palms", author: "Pi Station", appearance: "light", colors: { background: "#f8faf7", foreground: "#191720", accent: "#6e2d6d", error: "#8b3327", warning: "#806000", success: "#47734b" }, packaged: true },
  { schemaVersion: 1, id: "catppuccin-latte", name: "Catppuccin Latte", author: "Catppuccin", appearance: "light", colors: { background: "#eff1f5", foreground: "#383b53", accent: "#1e66f5", error: "#d20f39", warning: "#df8e1d", success: "#40a02b" }, packaged: true },
  { schemaVersion: 1, id: "everforest-light", name: "Everforest Light", author: "Everforest", appearance: "light", colors: { background: "#fbfaf4", foreground: "#394740", accent: "#5f7f6a", error: "#a96159", warning: "#987a48", success: "#708058" }, packaged: true },
  { schemaVersion: 1, id: "dayfox", name: "Dayfox", author: "Nightfox", appearance: "light", colors: { background: "#f6f2ee", foreground: "#3d2b5a", accent: "#287980", error: "#a5222f", warning: "#ac5402", success: "#396847" }, packaged: true },
  { schemaVersion: 1, id: "github-light", name: "GitHub Light", author: "GitHub", appearance: "light", colors: { background: "#ffffff", foreground: "#1f2328", accent: "#0969da", error: "#d1242f", warning: "#9a6700", success: "#1a7f37" }, packaged: true },
  { schemaVersion: 1, id: "tri-palms", name: "Tri-Palms", author: "Pi Station", appearance: "dark", colors: { background: "#111111", foreground: "#ffffff", accent: "#4977ff", error: "#ed8a87", warning: "#ffc120", success: "#72b879" }, packaged: true },
  { schemaVersion: 1, id: "catppuccin", name: "Catppuccin", author: "Catppuccin", appearance: "dark", colors: { background: "#1e1e2e", foreground: "#cdd6f4", accent: "#89b4fa", error: "#f38ba8", warning: "#f9e2af", success: "#a6e3a1" }, packaged: true },
  { schemaVersion: 1, id: "tokyo-night", name: "Tokyo Night", author: "Tokyo Night", appearance: "dark", colors: { background: "#1a1b26", foreground: "#a9b1d6", accent: "#7aa2f7", error: "#f7768e", warning: "#e0af68", success: "#9ece6a" }, packaged: true },
  { schemaVersion: 1, id: "everforest", name: "Everforest", author: "Everforest", appearance: "dark", colors: { background: "#2d353b", foreground: "#e2d8bf", accent: "#7fbbb3", error: "#e67e80", warning: "#dbbc7f", success: "#a7c080" }, packaged: true },
  { schemaVersion: 1, id: "ristretto", name: "Ristretto", author: "Ristretto", appearance: "dark", colors: { background: "#2c2525", foreground: "#e6d9db", accent: "#f38d70", error: "#fd6883", warning: "#f9cc6c", success: "#adda78" }, packaged: true },
];

const media = typeof matchMedia === "function"
  ? matchMedia("(prefers-color-scheme: dark)")
  : { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };
const read = (key: string, fallback: string): string => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const storedAppearance = read("pi-station:appearance", "system");
let appearancePreference: AppearancePreference = storedAppearance === "light" || storedAppearance === "dark" ? storedAppearance : "system";
let themeSource: ThemeSource = read("pi-station:theme-source", "system") === "pi-station" ? "pi-station" : "system";
let systemTheme: SystemTheme = { version: 2, available: false };
const selections: Record<ThemeAppearance, string> = {
  light: read("pi-station:light-theme", "palms"),
  dark: read("pi-station:dark-theme", "tri-palms"),
};
export const readAppearance = (): AppearancePreference => appearancePreference;
export const readThemeSource = (): ThemeSource => themeSource;
export const readSystemTheme = (): SystemTheme => systemTheme;
export const selectedThemeId = (appearance: ThemeAppearance): string => selections[appearance];
export function activeAppearance(): ThemeAppearance { return appearancePreference === "system" ? (media.matches ? "dark" : "light") : appearancePreference; }
function updateThemeColor(color: string): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = color;
}
function savedBackground(appearance: ThemeAppearance, id: string): string | undefined {
  const packaged = packagedThemes.find((theme) => theme.id === id);
  if (packaged !== undefined) return packaged.colors.background;
  const saved = read(`pi-station:${appearance}-theme-background`, "");
  return /^#[0-9a-fA-F]{6}$/u.test(saved) ? saved : undefined;
}
export function applySelectedTheme(): void {
  const root = document.documentElement;
  const custom = document.querySelector<HTMLLinkElement>("#installed-theme-stylesheet");
  if (themeSource === "system" && systemTheme.available) {
    root.dataset.appearance = systemTheme.appearance;
    root.dataset.themeId = "omarchy-system";
    root.style.setProperty("--theme-background", systemTheme.colors.background);
    root.style.setProperty("--theme-foreground", systemTheme.colors.foreground);
    root.style.setProperty("--theme-accent", systemTheme.colors.accent);
    root.style.setProperty("--theme-error", systemTheme.colors.error);
    root.style.setProperty("--theme-warning", systemTheme.colors.warning);
    root.style.setProperty("--theme-success", systemTheme.colors.success);
    updateThemeColor(systemTheme.colors.background);
    custom?.remove();
    return;
  }
  for (const property of ["--theme-background", "--theme-foreground", "--theme-accent", "--theme-error", "--theme-warning", "--theme-success"]) root.style.removeProperty(property);
  const appearance = activeAppearance();
  const id = selectedThemeId(appearance);
  root.dataset.appearance = appearance;
  root.dataset.themeId = id;
  const background = savedBackground(appearance, id);
  if (background !== undefined) updateThemeColor(background);
  if (packagedThemes.some((theme) => theme.id === id)) custom?.remove();
  else {
    const link = custom ?? Object.assign(document.createElement("link"), { id: "installed-theme-stylesheet", rel: "stylesheet" });
    link.addEventListener("load", () => updateThemeColor(getComputedStyle(root).getPropertyValue("--page").trim()), { once: true });
    link.href = `/api/themes/${encodeURIComponent(id)}.css`;
    if (custom === null) document.head.append(link);
  }
}
export function saveAppearance(value: AppearancePreference): void { appearancePreference = value; try { localStorage.setItem("pi-station:appearance", value); } catch { /* Storage can be unavailable. */ } applySelectedTheme(); }
export function saveThemeSource(value: ThemeSource): void {
  themeSource = value;
  try { localStorage.setItem("pi-station:theme-source", value); } catch { /* Storage can be unavailable. */ }
  updateSystemThemeStream();
  if (value === "system") void refreshSystemTheme();
  applySelectedTheme();
}
export function saveSelectedTheme(theme: ThemeDefinition): void { selections[theme.appearance] = theme.id; try { localStorage.setItem(`pi-station:${theme.appearance}-theme`, theme.id); localStorage.setItem(`pi-station:${theme.appearance}-theme-background`, theme.colors.background); } catch { /* Storage can be unavailable. */ } applySelectedTheme(); }

let events: EventSource | undefined;
let requestGeneration = 0;
let eventGeneration = 0;

function publishSystemTheme(theme: SystemTheme): void {
  systemTheme = theme;
  applySelectedTheme();
  window.dispatchEvent(new CustomEvent("pi-station:system-theme", { detail: systemTheme }));
}

function parseSystemTheme(value: unknown): SystemTheme | undefined {
  return isSystemTheme(value) ? value : undefined;
}

async function refreshSystemTheme(): Promise<void> {
  const request = ++requestGeneration;
  const eventAtStart = eventGeneration;
  try {
    const response = await fetch("/v2/appearance/system-theme", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const theme = parseSystemTheme(await response.json());
    if (theme === undefined || request !== requestGeneration || eventAtStart !== eventGeneration) return;
    publishSystemTheme(theme);
  } catch { /* Non-Omarchy hosts and offline clients keep the Pi Station theme. */ }
}

function updateSystemThemeStream(): void {
  if (themeSource !== "system" || typeof EventSource !== "function") { events?.close(); events = undefined; return; }
  if (events !== undefined) return;
  events = new EventSource("/v2/appearance/system-theme/events");
  events.addEventListener("system-theme.changed", (event) => {
    try {
      const theme = parseSystemTheme(JSON.parse((event as MessageEvent<string>).data));
      if (theme === undefined) return;
      eventGeneration += 1;
      requestGeneration += 1;
      publishSystemTheme(theme);
    } catch { /* Ignore malformed events and keep the last valid theme. */ }
  });
}

const refreshVisibleSystemTheme = (): void => { if (document.visibilityState === "visible") void refreshSystemTheme(); };
export function stopSystemThemeSync(): void {
  requestGeneration += 1;
  events?.close();
  events = undefined;
  document.removeEventListener("visibilitychange", refreshVisibleSystemTheme);
  media.removeEventListener("change", applySelectedTheme);
}

media.addEventListener("change", applySelectedTheme);
document.addEventListener("visibilitychange", refreshVisibleSystemTheme);
applySelectedTheme();
if (typeof fetch === "function") void refreshSystemTheme();
updateSystemThemeStream();
if (import.meta.hot !== undefined) import.meta.hot.dispose(stopSystemThemeSync);
