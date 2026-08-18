export const markdownVimModeKey = "pi-station:markdown-vim-mode";

export function readMarkdownVimMode(): boolean {
  try { return globalThis.localStorage?.getItem(markdownVimModeKey) === "true"; } catch { return false; }
}

export function writeMarkdownVimMode(enabled: boolean): void {
  try { globalThis.localStorage?.setItem(markdownVimModeKey, String(enabled)); } catch { /* Local storage is optional. */ }
}
