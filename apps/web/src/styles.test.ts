import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const selectSource = readFileSync(resolve(process.cwd(), "src/components/ui/select.tsx"), "utf8");
const workspaceSource = readFileSync(resolve(process.cwd(), "src/components/Workspace.tsx"), "utf8");
const dialogSource = readFileSync(resolve(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");

describe("composer width", () => {
  it("uses a separate 960px composer width and keeps the Timeline width", () => {
    expect(styles).toContain("--content: 760px;");
    expect(styles).toContain("--composer-content: 960px;");
    expect(styles).toMatch(/\.composer\s*{[^}]*var\(--composer-content\)/s);
    expect(styles).toMatch(/\.follow-up-queue\s*{[^}]*var\(--composer-content\)/s);
    expect(styles).toMatch(/\.voice-mode\s*{[^}]*var\(--composer-content\)/s);
  });

  it("does not override all shadcn composer buttons with circular legacy styles", () => {
    expect(styles).not.toMatch(/\.composer button\s*{/);
    expect(styles).toMatch(/\.composer-primary-actions > button:last-child\s*{[^}]*border-radius: 50%;/s);
    expect(styles).toMatch(/\.composer-settings-desktop\s*{[^}]*gap: 10px;/s);
    expect(styles).toContain(".composer-model-trigger");
    expect(styles).toContain(".composer-thinking-trigger");
  });

  it("keeps only the small transcription control transparent in every interaction state", () => {
    expect(workspaceSource).toMatch(/className="composer-transcription-button"\s*data-state=/);
    expect(styles).toMatch(/\.composer-primary-actions > \.composer-transcription-button,\s*\.composer-primary-actions > \.composer-transcription-button:hover,\s*\.composer-primary-actions > \.composer-transcription-button:focus,\s*\.composer-primary-actions > \.composer-transcription-button:focus-visible,\s*\.composer-primary-actions > \.composer-transcription-button:active,\s*\.composer-primary-actions > \.composer-transcription-button:disabled\s*{[^}]*width: 40px;[^}]*height: 40px;[^}]*background: transparent;/s);
    expect(styles).toMatch(/\.composer-primary-actions > \.composer-transcription-button\[data-state="recording"\],\s*\.composer-primary-actions > \.composer-transcription-button\[data-state="processing"\]\s*{[^}]*color: var\(--danger\);/s);
  });

  it("does not change the Send, open-voice-mode, or full voice-mode controls", () => {
    expect(styles).toMatch(/\.composer-primary-actions > button:last-child\s*{[^}]*background: var\(--accent\);/s);
    expect(styles).toMatch(/\.voice-mode-record-icon\s*{[^}]*background: var\(--accent\);/s);
    expect(styles).toMatch(/\.voice-mode-record\[data-state="recording"\] \.voice-mode-record-icon,[^{]*{[^}]*background: var\(--danger\);/s);
    expect(workspaceSource).toContain('className="voice-mode-record"');
  });

  it("uses 12px type and opaque theme surfaces for model and thinking menus", () => {
    expect(styles).toMatch(/\.composer-settings-desktop \.composer-model-trigger,\s*\.composer-settings-desktop \.composer-thinking-trigger\s*{[^}]*font-size: 12px;/s);
    expect(styles).toMatch(/\.composer-setting-select-menu\s*{[^}]*background: var\(--raised\);[^}]*color: var\(--text\);/s);
    expect(styles).toMatch(/\.composer-setting-select-menu \[data-slot="select-item"\]\s*{[^}]*font-size: 12px;/s);
    expect(styles).toMatch(/\.composer-settings-mobile-menu\s*{[^}]*background: var\(--raised\);[^}]*color: var\(--text\);/s);
    expect(styles).toMatch(/\.composer-settings-mobile-menu \.composer-mobile-setting-label,\s*\.composer-settings-mobile-menu \.composer-mobile-setting-option\s*{[^}]*font-size: 12px;/s);
    expect(selectSource).toContain("bg-[var(--raised)]");
    expect(selectSource).not.toContain("bg-popover");
  });
});

describe("Quick Session modal", () => {
  it("uses an opaque 960px desktop surface without backdrop blur", () => {
    expect(styles).toMatch(/\.quick-session-dialog\s*{[^}]*width: min\(960px, calc\(100vw - 48px\)\);[^}]*height: 85dvh;[^}]*background: var\(--page\);/s);
    expect(dialogSource).toContain("z-[80] bg-black/45");
    expect(dialogSource).not.toContain("backdrop-blur");
  });

  it("uses a safe-area full-screen mobile layout and a sticky composer", () => {
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.quick-session-dialog\s*\{[^}]*width: 100vw;[^}]*height: 100dvh;[^}]*translate: 0 0 !important;/);
    expect(styles).toContain("padding-top: env(safe-area-inset-top)");
    expect(styles).toMatch(/\.quick-session-dialog\s*\{[^}]*translate: 0 0 !important;/s);
    expect(styles).toMatch(/\.quick-session-dialog-body \.embedded-session \.composer-shell\s*{[^}]*position: sticky;/s);
  });
});

describe("iOS-safe status animations", () => {
  it("keeps status animations usable when reduced motion is reported", () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.initial-connection-mark\s*{[^}]*animation: initial-connection-spin 900ms linear infinite !important;/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.updating-mark\s*{[^}]*animation: initial-connection-spin 1\.1s linear infinite !important;/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.thinking-dots > span\s*{[^}]*animation-duration: 1s !important;/);
  });

  it("centers the thinking dots and starts them at stable animation phases", () => {
    expect(styles).toMatch(/\.thinking-placeholder-copy\s*{[^}]*align-items: center;/s);
    expect(styles).toContain(".thinking-dots > span:nth-child(2) { animation-delay: -860ms; }");
    expect(styles).toContain(".thinking-dots > span:nth-child(3) { animation-delay: -720ms; }");
  });
});

describe("sidebar Session accessory layout", () => {
  it("overlaps content and shortcut layers in one fixed accessory slot", () => {
    expect(styles).toMatch(/\.session-row-accessory-content,\s*\.session-row-shortcut\s*{[^}]*position: absolute;[^}]*inset: 2px;[^}]*pointer-events: none;/s);
    expect(styles).toMatch(/\.session-row-accessory\s*{[^}]*isolation: isolate;[^}]*grid-column: 3;/s);
    expect(styles).toMatch(/\.sidebar\.shortcuts-visible \.session-row-shortcut\s*{[^}]*z-index: 2;[^}]*visibility: visible;/s);
    expect(styles).toMatch(/\.sidebar\.shortcuts-visible \.session-row-accessory-content\s*{[^}]*z-index: 0;[^}]*visibility: hidden;/s);
  });

  it("does not reserve a column for a separate unread marker", () => {
    expect(styles).not.toContain(".session-row[data-session-shortcut]:after");
    expect(styles).toMatch(/grid-template-columns: 10px minmax\(0, 1fr\) 24px;/);
    expect(styles).not.toContain("session-row-unread-slot");
  });
});

describe("sidebar Session status indicator", () => {
  it("uses exact fixed status colors and the application appearance for idle", () => {
    expect(styles).toContain("--session-status-working: #f59e0b;");
    expect(styles).toContain("--session-status-unread: #14b86b;");
    expect(styles).toContain("--session-status-idle: #cbd5e1;");
    expect(styles).toMatch(/:root\[data-appearance="dark"\][^{]*\{[^}]*--session-status-idle: #94a3b8;/s);
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-appearance\]\)[^{]*\{[^}]*--session-status-idle: #94a3b8;/);
  });

  it("keeps idle and unread static while working uses one close breathing halo", () => {
    expect(styles).toMatch(/\.session-status-indicator\s*\{[^}]*box-shadow: none;/s);
    expect(styles).toMatch(/\.session-status-indicator\.status-unread\s*\{[^}]*background: var\(--session-status-unread\);/s);
    expect(styles).toMatch(/\.status-working::before\s*\{[^}]*inset: -2px;[^}]*animation: session-status-breathe 1\.8s ease-in-out infinite;/s);
    expect(styles).toMatch(/@keyframes session-status-breathe\s*\{[^}]*scale\(0\.9\)[^}]*\}[^}]*scale\(1\.12\)/s);
    expect(styles).not.toContain("session-status-pulse");
    expect(styles).not.toMatch(/\.status-working::after/);
    expect(styles).not.toMatch(/\.status-(?:idle|unread)[^{]*\{[^}]*(?:animation|box-shadow):/s);
  });

  it("replaces breathing motion with one static working halo", () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.status-working::before\s*\{[^}]*opacity: 0\.38;[^}]*transform: scale\(1\);[^}]*animation: none;/);
  });
});
