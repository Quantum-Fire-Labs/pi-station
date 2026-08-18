// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDefaultsPage } from "./SessionDefaultsPage";

const initial = { provider: "openai-codex", modelId: "gpt-5.6-sol", thinkingLevel: "medium" };
const models = [
  { provider: "openai-codex", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
  { provider: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
];

describe("Session Defaults page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads authenticated model choices from the SDK server", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ defaults: initial, models }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionDefaultsPage onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue(JSON.stringify(["openai-codex", "gpt-5.6-sol"])));
    expect(fetchMock).toHaveBeenCalledWith("/v2/session-defaults", { cache: "no-store", headers: { Accept: "application/json" } });
    expect(screen.getByRole("option", { name: "GPT-5.6 Sol · openai-codex" })).toBeInTheDocument();
    expect(screen.getByText(/Delegated Sessions inherit/)).toBeInTheDocument();
  });

  it("saves one available model as the Session default", async () => {
    const saved = { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "high" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ defaults: initial, models }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ defaults: saved }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionDefaultsPage onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: JSON.stringify([saved.provider, saved.modelId]) } });
    fireEvent.change(screen.getByDisplayValue("Medium"), { target: { value: saved.thinkingLevel } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Defaults saved."));
    expect(fetchMock).toHaveBeenLastCalledWith("/v2/session-defaults", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(saved),
    }));
  });
});
