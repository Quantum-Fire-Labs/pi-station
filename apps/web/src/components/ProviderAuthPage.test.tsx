// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthPage } from "./ProviderAuthPage";

const provider = { id: "example", name: "Example", configured: false, methods: [{ type: "oauth" as const, name: "Sign in" }, { type: "api_key" as const, name: "API key" }] };
const running = { id: "tx", providerId: "example", status: "running" as const, expiresAt: "2026-01-01T00:00:00.000Z", events: [{ type: "auth_url" as const, url: "https://login.example/authorize", instructions: "Sign in" }], prompt: { type: "secret" as const, message: "API key" } };
const client = () => ({ getAuthProviders: vi.fn().mockResolvedValue([provider]), startProviderLogin: vi.fn().mockResolvedValue(running), getAuthTransaction: vi.fn().mockResolvedValue(running), answerAuthPrompt: vi.fn().mockResolvedValue({ ...running, prompt: undefined }), cancelProviderLogin: vi.fn().mockResolvedValue({ ...running, status: "cancelled" }), logoutProvider: vi.fn().mockResolvedValue([]) });
const chooseExample = (): void => { fireEvent.click(screen.getByRole("button", { name: /Example/ })); };
const chooseSignIn = (): void => { fireEvent.click(screen.getByText("Sign in", { selector: "strong" }).closest("button")!); };

describe("ProviderAuthPage", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("filters providers, selects an equal-weight method, and renders safe secret interactions", async () => {
    const api = client(); const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ProviderAuthPage client={api} onboarding />);
    await screen.findByText("Example");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search providers" }), { target: { value: "missing" } });
    expect(screen.queryByText("Example")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search providers" }), { target: { value: "example" } });
    chooseExample(); chooseSignIn();
    await screen.findByText("Continue in your browser");
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in page/ }));
    expect(open).toHaveBeenCalledWith("https://login.example/authorize", "_blank", "noopener,noreferrer");
    const secret = screen.getByLabelText("API key"); expect(secret).toHaveAttribute("type", "password");
    fireEvent.change(secret, { target: { value: "private" } }); fireEvent.submit(secret.closest("form")!);
    await waitFor(() => expect(api.answerAuthPrompt).toHaveBeenCalledWith("tx", "private"));
    expect(api.startProviderLogin).toHaveBeenCalledWith("example", "oauth");
  });

  it("uses an existing credential and saves the selected default model", async () => {
    const api = client(); api.getAuthProviders.mockResolvedValue([{ ...provider, configured: true, configuredType: "api_key", source: "ANTHROPIC_API_KEY" }]);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ defaults: { provider: "example", modelId: "model-a", thinkingLevel: "medium" }, models: [{ provider: "example", modelId: "model-a", displayName: "Model A" }] }))
      .mockResolvedValueOnce(Response.json({ defaults: { provider: "example", modelId: "model-a", thinkingLevel: "medium" } }));
    vi.stubGlobal("fetch", fetchMock);
    const complete = vi.fn(); render(<ProviderAuthPage client={api} onboarding onComplete={complete} />);
    await screen.findByText("Connected"); chooseExample(); fireEvent.click(screen.getByText("Use connected account", { selector: "strong" }).closest("button")!);
    expect(await screen.findByRole("heading", { name: "Choose your default model" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start using Pi Station" }));
    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith("/v2/session-defaults", expect.objectContaining({ method: "PUT", body: JSON.stringify({ provider: "example", modelId: "model-a", thinkingLevel: "medium" }) }));
  });

  it("renders device-code and select interactions", async () => {
    const api = client(); api.startProviderLogin.mockResolvedValue({ ...running, events: [{ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://device.example" }], prompt: { type: "select", message: "Choose an account", options: [{ id: "work", label: "Work", description: "Team account" }] } });
    render(<ProviderAuthPage client={api} onboarding />); await screen.findByText("Example"); chooseExample(); chooseSignIn();
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose an account"), { target: { value: "work" } }); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(api.answerAuthPrompt).toHaveBeenCalledWith("tx", "work"));
  });

  it("does not make non-HTTPS authentication URLs clickable", async () => {
    const api = client(); api.startProviderLogin.mockResolvedValue({ ...running, events: [{ type: "auth_url", url: "http://login.example/steal" }] });
    render(<ProviderAuthPage client={api} onboarding />); await screen.findByText("Example"); chooseExample(); chooseSignIn();
    await waitFor(() => expect(api.startProviderLogin).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Open sign-in page/ })).not.toBeInTheDocument();
  });
});
