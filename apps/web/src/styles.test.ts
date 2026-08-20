import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

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

  it("keeps idle and unread static while working uses two pulse rings", () => {
    expect(styles).toMatch(/\.session-status-indicator\s*{[^}]*box-shadow: none;/s);
    expect(styles).toMatch(/\.session-status-indicator\.status-unread\s*{[^}]*background: var\(--session-status-unread\);/s);
    expect(styles).toMatch(/\.status-working::before,\s*\.session-row \.session-status-indicator\.status-working::after\s*{[^}]*animation: session-status-pulse/s);
    expect(styles).toContain("@keyframes session-status-pulse");
    expect(styles).not.toMatch(/\.status-(?:idle|unread)[^{]*\{[^}]*(?:animation|box-shadow):/s);
  });

  it("replaces motion with one static working halo", () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.status-working::before\s*{[^}]*animation: none;/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.status-working::after\s*{[^}]*display: none;[^}]*animation: none;/);
  });
});
