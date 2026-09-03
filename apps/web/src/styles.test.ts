import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const selectSource = readFileSync(resolve(process.cwd(), "src/components/ui/select.tsx"), "utf8");
const composerControlsSource = readFileSync(resolve(process.cwd(), "src/components/ComposerControls.tsx"), "utf8");
const workspaceSource = readFileSync(resolve(process.cwd(), "src/components/Workspace.tsx"), "utf8");
const workspaceSwitcherSource = readFileSync(resolve(process.cwd(), "src/components/WorkspaceSwitcher.tsx"), "utf8");
const dialogSource = readFileSync(resolve(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");

describe("composer width", () => {
  it("uses a separate 960px composer width and keeps the Timeline width", () => {
    expect(styles).toContain("--content: 960px;");
    expect(styles).toContain("--composer-content: 960px;");
    expect(styles).toMatch(/\.composer\s*{[^}]*var\(--composer-content\)/s);
    expect(styles).toMatch(/\.composer\s*{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 16px;/s);
    expect(styles).toMatch(/\.follow-up-queue\s*{[^}]*var\(--composer-content\)/s);
    expect(styles).toMatch(/\.follow-up-queue li\s*\{[^}]*width: min\(92%, 620px\);[^}]*border-radius: 14px 14px 3px;[^}]*background: var\(--user\);/s);
    expect(styles).toMatch(/\.message\.user \.message-body,\s*\.follow-up-queue li > span\s*{[^}]*font-size: 15px;[^}]*line-height: 1\.5;/s);
    expect(styles).toMatch(/\.voice-mode\s*{[^}]*var\(--composer-content\)/s);
    expect(styles).toMatch(/\.composer\s*{[^}]*min-height: 120px;/s);
    expect(styles).toMatch(/\.voice-mode\s*{[^}]*min-height: 120px;[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 16px;/s);
    expect(styles).toMatch(/\.voice-mode-status\s*{[^}]*display: flex;/s);
    expect(styles).toMatch(/\.voice-mode-primary-slot\s*{[^}]*width: 48px;/s);
    expect(styles).toMatch(/\.voice-mode-record-icon\s*{[^}]*width: 48px;[^}]*height: 48px;/s);
    expect(styles).not.toMatch(/\.voice-mode button, \.voice-mode select/);
    expect(styles).not.toContain(".session:has(.voice-mode)");
  });

  it("does not override all shadcn composer buttons with circular legacy styles", () => {
    expect(styles).not.toMatch(/\.composer button\s*{/);
    expect(styles).toMatch(/\.composer-primary-actions > button:last-child\s*{[^}]*border-radius: 50%;/s);
    expect(styles).toMatch(/\.composer-settings-desktop\s*{[^}]*gap: 10px;/s);
    expect(styles).toContain(".composer-model-trigger");
    expect(styles).toContain(".composer-thinking-trigger");
    expect(styles).toMatch(/\.composer-controls\s*\{[^}]*padding-inline: 6px;/s);
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

  it("uses muted borders, 12px type, and opaque theme surfaces for composer setting menus", () => {
    expect(styles).toMatch(/\.composer-settings-desktop \[data-slot="select-trigger"\]\s*\{[^}]*border-color: var\(--muted\);/s);
    expect(workspaceSource).toMatch(/variant="ghost"\s*size="icon"\s*disabled=[\s\S]*aria-label="Attach files"/);
    expect(styles).not.toContain(".composer-attachment-button");
    expect(styles).toMatch(/\.composer-settings-desktop \.composer-model-trigger,\s*\.composer-settings-desktop \.composer-thinking-trigger,\s*\.composer-settings-desktop \.composer-delivery-trigger\s*{[^}]*font-size: 12px;/s);
    expect(styles).toMatch(/\.composer-setting-select-menu\s*{[^}]*background: var\(--raised\);[^}]*color: var\(--text\);/s);
    expect(styles).toMatch(/\.composer-setting-select-menu \[data-slot="select-item"\]\s*{[^}]*font-size: 12px;/s);
    expect(styles).toMatch(/\.composer-settings-mobile-menu\s*{[^}]*background: var\(--raised\);[^}]*color: var\(--text\);/s);
    expect(styles).toMatch(/\.composer-settings-mobile-menu \.composer-mobile-setting-label,\s*\.composer-settings-mobile-menu \.composer-mobile-setting-option\s*{[^}]*font-size: 12px;/s);
    expect(selectSource).toContain("bg-[var(--raised)]");
    expect(selectSource).not.toContain("bg-popover");
    expect(selectSource).toContain('className={cn("isolate z-50", positionerClassName)}');
    expect(composerControlsSource).toContain('positionerClassName="z-[90]"');
  });
});

describe("Omarchy TUI styling", () => {
  it("uses shared compositor tokens without broad important radius overrides", () => {
    expect(styles).toContain("--omarchy-radius: var(--omarchy-corner-radius, 0px);");
    expect(styles).toContain("font-size: var(--omarchy-base-font-size, 14px);");
    expect(styles).toMatch(/\.message\.context-summary details,[\s\S]*border-radius: var\(--omarchy-radius\);/);
    expect(styles).not.toMatch(/data-theme-id="omarchy-system"[\s\S]{0,700}border-radius:\s*0\s*!important/);
    expect(styles).toMatch(/\.session-row,[\s\S]*:focus-visible\s*{[^}]*box-shadow: inset 3px 0 0 var\(--accent\);/s);
    expect(styles).toMatch(/\.message\.tool details summary\s*{[^}]*min-height: 24px;[^}]*gap: 6px;/s);
    expect(styles).toMatch(/\.message\.tool details\[open\] pre\s*{[^}]*border: 1px solid var\(--line\);/s);
  });

  it("removes web lift and decorative transitions while leaving circle tokens alone", () => {
    expect(styles).toMatch(/data-theme-id="omarchy-system"[^}]*:where\(button, a, input, textarea, select, summary,[^}]*{\s*transition: none;/s);
    expect(styles).toMatch(/data-theme-id="omarchy-system"[^}]*\.provider-choice:hover\s*{\s*transform: none;/s);
    expect(styles).not.toMatch(/data-theme-id="omarchy-system"[^}]*border-radius: 50%/s);
  });
});

describe("Session header", () => {
  it("clamps the Session name to one line", () => {
    expect(styles).toMatch(/\.session-title-text\s*\{[^}]*-webkit-line-clamp: 1;/s);
  });
});

describe("Quick Session modal", () => {
  it("places Session creation in Workspace actions and keeps Settings in the footer", () => {
    expect(workspaceSwitcherSource).toMatch(/DropdownMenuContent[\s\S]*Quick Session[\s\S]*New Session[\s\S]*Rename Workspace[\s\S]*Delete Workspace/);
    expect(workspaceSource).toMatch(/className={`sidebar-home[\s\S]*className="sidebar-primary-actions"[\s\S]*aria-label="Projects"[\s\S]*<footer>[\s\S]*aria-label="Settings"/);
  });

  it("uses a compact opaque desktop surface without backdrop blur", () => {
    expect(styles).toMatch(/\.quick-session-dialog\s*{[^}]*width: min\(800px, calc\(100vw - 48px\)\);[^}]*height: 65dvh;[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 22px;[^}]*background: var\(--page\);[^}]*animation: none;[^}]*transition: none;/s);
    expect(styles).toMatch(/\.quick-session-dialog-header\s*{[^}]*background: var\(--page\);/s);
    expect(dialogSource).toContain("z-[80] bg-transparent");
    expect(dialogSource).toContain("rounded-lg border border-border bg-background p-6");
    expect(dialogSource).not.toContain("backdrop-blur");
  });

  it("uses a safe-area full-screen mobile layout and a sticky composer", () => {
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.quick-session-dialog\s*\{[^}]*width: 100vw;[^}]*height: 100dvh;[^}]*translate: 0 0 !important;/);
    expect(styles).toContain("padding-top: env(safe-area-inset-top)");
    expect(styles).toMatch(/\.quick-session-dialog\s*\{[^}]*translate: 0 0 !important;/s);
    expect(styles).toMatch(/\.quick-session-dialog-body \.embedded-session \.composer-shell\s*{[^}]*position: sticky;[^}]*padding: 8px;/s);
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

describe("sidebar Project hierarchy", () => {
  it("uses the theme accent for Project names while Session titles keep the primary text color", () => {
    expect(styles).toMatch(/\.project header \.project-name-link\s*\{[^}]*color: var\(--accent\);/s);
    expect(styles).toMatch(/\.project header \.project-name-link:hover,\s*\.project header \.project-name-link\.selected\s*\{[^}]*color: var\(--accent2\);/s);
    expect(styles).toMatch(/\.session-row\s*\{[^}]*color: var\(--text\);/s);
    expect(styles).toMatch(/\.project\.unavailable header \.project-name-link,[^{]*\{[^}]*color: var\(--faint\);/s);
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
  it("uses fixed active colors and matches the title bar for idle", () => {
    expect(styles).toContain("--session-status-working: #f59e0b;");
    expect(styles).toContain("--session-status-unread: #14b86b;");
    expect(styles).toMatch(/\.session-status-indicator\s*\{[^}]*background: var\(--strong\);/s);
    expect(styles).toMatch(/\.session-title i\s*\{[^}]*background: var\(--strong\);/s);
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

describe("Omarchy square geometry", () => {
  it("squares tool cards, Send, and Project icon containers", () => {
    expect(styles).toMatch(/:root\[data-theme-id="omarchy-system"\] \.message\.tool details,[\s\S]*\.message\.tool details pre\s*\{[^}]*border-radius: 0;/);
    expect(styles).toMatch(/:root\[data-theme-id="omarchy-system"\] \.composer-primary-actions > button:last-child,[\s\S]*\.dashboard-project-icon,[\s\S]*\.creation-item-icon\s*\{[^}]*border-radius: 0;/);
  });

  it("uses compact sidebar labels and Settings iconography", () => {
    expect(styles).toMatch(/\.project header \.project-name-link,[\s\S]*\.session-row-name\s*\{[^}]*font-size: 11px;/);
    expect(styles).toMatch(/\.sidebar > footer button\s*\{[^}]*font-size: 10px;/);
    expect(styles).toMatch(/\.sidebar > footer button svg\s*\{[^}]*width: 13px;[^}]*height: 13px;/);
  });

  it("makes the command palette square, compact, and keyboard-first", () => {
    expect(styles).toMatch(/\.palette,[\s\S]*\.palette-results button\.active:before\s*\{[^}]*border-radius: 0;/);
    expect(styles).toMatch(/\.palette\s*\{[^}]*width: min\(calc\(100% - 28px\), 500px\);[^}]*box-shadow: none;/);
    expect(styles).toMatch(/\.palette-results button\s*\{[^}]*min-height: 36px;/);
    expect(styles).toMatch(/\.palette-results button:focus-visible\s*\{[^}]*box-shadow: inset 3px 0 0 var\(--accent\);/);
  });
});
