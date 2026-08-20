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

  it("does not use a row pseudo-element that can stack the shortcut vertically", () => {
    expect(styles).not.toContain(".session-row[data-session-shortcut]:after");
    expect(styles).toMatch(/grid-template-columns: 10px minmax\(0, 1fr\) 24px 8px;/);
    expect(styles).toMatch(/\.session-row-unread-slot\s*{\s*grid-column: 4;/);
  });
});
