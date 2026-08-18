// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationSettings } from "./NotificationSettings";

const publicKey = Buffer.from([4, ...Array<number>(64).fill(1)]).toString("base64url");
const subscription = {
  endpoint: "https://push.example.test/device",
  toJSON: () => ({ endpoint: "https://push.example.test/device", keys: { p256dh: "key", auth: "auth" } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};
const getSubscription = vi.fn();
const subscribe = vi.fn();

function installBrowser(permission: NotificationPermission = "default"): void {
  Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission, requestPermission: vi.fn().mockResolvedValue(permission === "default" ? "granted" : permission) },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  });
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
}

describe("Notification settings", () => {
  afterEach(cleanup);
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    getSubscription.mockReset().mockResolvedValue(null);
    subscribe.mockReset().mockResolvedValue(subscription);
    subscription.unsubscribe.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.includes("capabilities") ? { available: true, publicKey } : {},
    })));
    installBrowser();
  });

  it("shows unsupported state without requesting permission", async () => {
    Object.defineProperty(window, "PushManager", { configurable: true, value: undefined });
    render(<NotificationSettings surface="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("This browser does not support notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("requests permission only after explicit Enable interaction", async () => {
    render(<NotificationSettings surface="desktop" />);
    await waitFor(() => expect(getSubscription).toHaveBeenCalled());
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }));
    expect(fetch).toHaveBeenCalledWith("/v2/notifications/subscription", expect.objectContaining({ body: expect.stringContaining('"action":"subscribe"') }));
  });

  it("shows denied state", async () => {
    installBrowser("denied");
    render(<NotificationSettings surface="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await waitFor(() => expect(screen.getByText("Notification permission is blocked.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(screen.getByText("Notification permission is blocked.")).toBeInTheDocument());
  });

  it("shows busy and safe error states", async () => {
    let resolvePermission!: (value: NotificationPermission) => void;
    const pending = new Promise<NotificationPermission>((resolve) => { resolvePermission = resolve; });
    vi.mocked(window.Notification.requestPermission).mockReturnValue(pending);
    render(<NotificationSettings surface="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeDisabled();
    resolvePermission("granted");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await waitFor(() => expect(screen.getByText("Could not change notification settings.")).toBeInTheDocument());
  });

  it("disables an enabled subscription and persists desktop presence preference", async () => {
    getSubscription.mockResolvedValue(subscription);
    render(<NotificationSettings surface="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await waitFor(() => expect(screen.getByText("Notifications are enabled.")).toBeInTheDocument());
    const preference = screen.getByRole("checkbox");
    fireEvent.click(preference);
    expect(localStorage.getItem("pi-station:pause-mobile-notifications")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/v2/notifications/subscription", expect.objectContaining({ body: expect.stringContaining('"action":"unsubscribe"') }));
  });
});
