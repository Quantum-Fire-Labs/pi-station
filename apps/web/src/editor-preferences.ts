export const markdownVimModeKey = "pi-station:markdown-vim-mode";
export const markdownAutosaveKey = "pi-station:markdown-autosave";

export function readMarkdownVimMode(): boolean {
  try { return globalThis.localStorage?.getItem(markdownVimModeKey) === "true"; } catch { return false; }
}

export function writeMarkdownVimMode(enabled: boolean): void {
  try { globalThis.localStorage?.setItem(markdownVimModeKey, String(enabled)); } catch { /* Local storage is optional. */ }
}

export function readMarkdownAutosave(): boolean {
  try { return globalThis.localStorage?.getItem(markdownAutosaveKey) === "true"; } catch { return false; }
}

export function writeMarkdownAutosave(enabled: boolean): void {
  try { globalThis.localStorage?.setItem(markdownAutosaveKey, String(enabled)); } catch { /* Local storage is optional. */ }
}
