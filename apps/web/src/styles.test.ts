import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

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
