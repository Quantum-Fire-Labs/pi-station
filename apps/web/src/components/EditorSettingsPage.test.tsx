// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorSettingsPage } from "./EditorSettingsPage";

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("saves the autosave preference for the Markdown editor", async () => {
  render(<EditorSettingsPage onBack={vi.fn()} />);

  const toggle = screen.getByRole("switch", { name: /Autosave/i });
  expect(toggle).not.toBeChecked();

  await userEvent.click(toggle);

  expect(toggle).toBeChecked();
  expect(values.get("pi-station:markdown-autosave")).toBe("true");
  expect(screen.getByText(/Save button remains available/i)).toBeInTheDocument();
});

it("saves the Vim motions preference for the Markdown editor", async () => {
  render(<EditorSettingsPage onBack={vi.fn()} />);

  const toggle = screen.getByRole("switch", { name: /Vim motions/i });
  expect(toggle).not.toBeChecked();

  await userEvent.click(toggle);

  expect(toggle).toBeChecked();
  expect(values.get("pi-station:markdown-vim-mode")).toBe("true");
  expect(screen.getByText(/standalone editor/i)).toBeInTheDocument();
});
