// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthPage } from "./ProviderAuthPage";

const provider = { id: "example", name: "Example", configured: false, methods: [{ type: "oauth" as const, name: "Sign in" }, { type: "api_key" as const, name: "API key" }] };
const running = { id: "tx", providerId: "example", status: "running" as const, expiresAt: "2026-01-01T00:00:00.000Z", events: [{ type: "auth_url" as const, url: "https://login.example/authorize", instructions: "Sign in" }], prompt: { type: "secret" as const, message: "API key" } };
const client = () => ({ getAuthProviders: vi.fn().mockResolvedValue([provider]), startProviderLogin: vi.fn().mockResolvedValue(running), getAuthTransaction: vi.fn().mockResolvedValue(running), answerAuthPrompt: vi.fn().mockResolvedValue({ ...running, prompt: undefined }), cancelProviderLogin: vi.fn().mockResolvedValue({ ...running, status: "cancelled" }), logoutProvider: vi.fn().mockResolvedValue([]) });

describe("ProviderAuthPage", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("selects a method, renders safe browser and secret prompt interactions, and submits one response", async () => {
    const api = client(); const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ProviderAuthPage client={api} onboarding />);
    await screen.findByText("Example");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search providers" }), { target: { value: "missing" } });
    expect(screen.queryByText("Example")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search providers" }), { target: { value: "example" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Sign in", { selector: "p" });
    fireEvent.click(screen.getByRole("button", { name: "Open sign-in page" }));
    expect(open).toHaveBeenCalledWith("https://login.example/authorize", "_blank", "noopener,noreferrer");
    const secret = screen.getByLabelText("API key"); expect(secret).toHaveAttribute("type", "password");
    fireEvent.change(secret, { target: { value: "private" } }); fireEvent.submit(secret.closest("form")!);
    await waitFor(() => expect(api.answerAuthPrompt).toHaveBeenCalledWith("tx", "private"));
    expect(api.startProviderLogin).toHaveBeenCalledWith("example", "oauth");
  });

  it("shows Continue after an existing CLI-compatible credential is detected", async () => {
    const api = client(); api.getAuthProviders.mockResolvedValue([{ ...provider, configured: true, configuredType: "api_key", source: "ANTHROPIC_API_KEY" }]);
    const complete = vi.fn(); render(<ProviderAuthPage client={api} onboarding onComplete={complete} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue to Pi Station" }));
    expect(complete).toHaveBeenCalled(); expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
  });

  it("renders device-code and select interactions", async () => {
    const api = client();
    api.startProviderLogin.mockResolvedValue({ ...running, events: [{ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://device.example" }], prompt: { type: "select", message: "Choose an account", options: [{ id: "work", label: "Work", description: "Team account" }] } });
    render(<ProviderAuthPage client={api} onboarding />); await screen.findByText("Example"); fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose an account"), { target: { value: "work" } }); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(api.answerAuthPrompt).toHaveBeenCalledWith("tx", "work"));
  });

  it("does not make unsafe authentication URLs clickable", async () => {
    const api = client(); api.startProviderLogin.mockResolvedValue({ ...running, events: [{ type: "auth_url", url: "http://login.example/steal" }] });
    render(<ProviderAuthPage client={api} onboarding />); await screen.findByText("Example"); fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(api.startProviderLogin).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Open sign-in page" })).not.toBeInTheDocument();
  });
});
