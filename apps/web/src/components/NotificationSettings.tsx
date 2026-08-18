import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { SettingsLayout } from "./SettingsLayout";
import { notificationDeviceId } from "../notifications";

export type NotificationState =
  | "unsupported"
  | "permission"
  | "enabled"
  | "disabled"
  | "busy"
  | "error";

const preferenceKey = "pi-station:pause-mobile-notifications";

function isDesktop(): boolean {
  return typeof matchMedia !== "function"
    || !matchMedia("(max-width: 760px)").matches;
}

function readPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(preferenceKey) !== "false";
  } catch {
    return true;
  }
}

function writePreference(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(preferenceKey, String(value));
    globalThis.dispatchEvent(new Event("pi-station:notification-preference"));
  } catch {
    // Local storage is optional.
  }
}

export function decodeVapidPublicKey(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{80,120}$/.test(value)) {
    throw new Error("Invalid push capability response");
  }
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Invalid push capability response");
  return bytes;
}

async function post(body: unknown): Promise<Response> {
  return fetch("/v2/notifications/subscription", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function NotificationSettings({ surface }: { surface: "desktop" | "mobile" | "page" }) {
  const supported = typeof navigator.serviceWorker !== "undefined"
    && typeof window.PushManager !== "undefined"
    && typeof window.Notification !== "undefined";
  const [state, setState] = useState<NotificationState>(supported ? "disabled" : "unsupported");
  const [open, setOpen] = useState(false);
  const [pauseMobile, setPauseMobile] = useState(readPreference);
  const trigger = useRef<HTMLButtonElement>(null);
  const appliesToViewport = surface === "page"
    || surface === (isDesktop() ? "desktop" : "mobile");

  const close = (): void => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  const refresh = useCallback(async () => {
    if (!supported || !appliesToViewport) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const saved = await post({
          action: "subscribe",
          deviceId: notificationDeviceId(),
          subscription: { ...subscription.toJSON(), deviceClass: isDesktop() ? "desktop" : "mobile" },
        });
        if (!saved.ok) throw new Error("Subscription rejected");
      }
      setState(subscription ? "enabled" : Notification.permission === "denied" ? "permission" : "disabled");
    } catch {
      setState("error");
    }
  }, [appliesToViewport, supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = async (): Promise<void> => {
    setState("busy");
    try {
      if (await Notification.requestPermission() !== "granted") {
        setState("permission");
        return;
      }
      const response = await fetch("/v2/notifications/capabilities", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Capabilities unavailable");
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== "available,publicKey"
        || (value as Record<string, unknown>).available !== true) {
        throw new Error("Invalid capabilities");
      }
      const publicKey = decodeVapidPublicKey((value as Record<string, unknown>).publicKey);
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const saved = await post({
        action: "subscribe",
        deviceId: notificationDeviceId(),
        subscription: {
          ...subscription.toJSON(),
          deviceClass: isDesktop() ? "desktop" : "mobile",
        },
      });
      if (!saved.ok) {
        await subscription.unsubscribe();
        throw new Error("Subscription rejected");
      }
      setState("enabled");
    } catch {
      setState("error");
    }
  };

  const disable = async (): Promise<void> => {
    setState("busy");
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription) {
        const response = await post({ action: "unsubscribe", deviceId: notificationDeviceId(), endpoint: subscription.endpoint });
        if (!response.ok) throw new Error("Unsubscribe rejected");
        await subscription.unsubscribe();
      }
      setState("disabled");
    } catch {
      setState("error");
    }
  };

  if (!appliesToViewport) return null;
  const message = state === "unsupported" ? "This browser does not support notifications."
    : state === "permission" ? "Notification permission is blocked."
      : state === "enabled" ? "Notifications are enabled."
        : state === "busy" ? "Saving…"
          : state === "error" ? "Could not change notification settings."
            : "Notifications are disabled.";

  const preference = (surface === "desktop" || (surface === "page" && isDesktop())) && (
    <label className="notification-preference">
      <input
        type="checkbox"
        checked={pauseMobile}
        onChange={(event) => {
          setPauseMobile(event.target.checked);
          writePreference(event.target.checked);
        }}
      />
      Pause mobile notifications while this desktop is active
    </label>
  );
  const action = state !== "unsupported" && (
    <Button
      type="button"
      variant={state === "enabled" ? "outline" : "default"}
      disabled={state === "busy"}
      onClick={() => void (state === "enabled" ? disable() : enable())}
    >{state === "enabled" ? "Disable" : "Enable"}</Button>
  );

  if (surface === "page") {
    return (
      <Card className="settings-card bg-transparent">
        <CardHeader>
          <CardTitle id="completion-notifications-heading">Completion notifications</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="settings-card-actions">{preference}{action}</CardContent>
      </Card>
    );
  }

  return <>
    <button ref={trigger} type="button" aria-label="Notifications" onClick={() => setOpen(true)}>
      <Bell aria-hidden="true" size={17} />
      {surface === "mobile" && <span>Notifications</span>}
    </button>
    <Modal
      open={open}
      title="Completion notifications"
      description={message}
      onClose={close}
      busy={state === "busy"}
      actions={<>
        <button type="button" onClick={close}>Close</button>
        {action}
      </>}
    >
      {preference}
    </Modal>
  </>;
}

export function NotificationSettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <SettingsLayout title="Notifications" description="Choose when Pi Station sends completion notifications." onBack={onBack}>
      <NotificationSettings surface="page" />
    </SettingsLayout>
  );
}
