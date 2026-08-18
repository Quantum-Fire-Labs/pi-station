import type { SessionKey } from "./application/workspace-model";

const deviceIdKey = "pi-station:notification-device-id";

export interface NotificationTarget {
  readonly hostId: string;
  readonly piSessionId: string;
}

export interface SafeNotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly data: NotificationTarget;
}

export function notificationDeviceId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(deviceIdKey);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(existing)) return existing;
    const created = globalThis.crypto.randomUUID();
    globalThis.localStorage?.setItem(deviceIdKey, created);
    return created;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

export function notificationPresence(
  selected: SessionKey | undefined,
  options: { readonly desktop: boolean; readonly pauseMobile: boolean; readonly visible: boolean },
): Record<string, unknown> {
  return {
    deviceId: notificationDeviceId(),
    desktopActive: options.desktop && options.pauseMobile && options.visible,
    ...(selected === undefined || !options.visible ? {} : {
      visibleSession: { projectId: selected.hostId, sessionId: selected.piSessionId },
    }),
  };
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

export function validNotificationTarget(value: unknown): NotificationTarget | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "hostId,piSessionId"
    || !bounded(input.hostId, 200)
    || !bounded(input.piSessionId, 500)) return undefined;
  return { hostId: input.hostId, piSessionId: input.piSessionId };
}

export function validNotificationPayload(value: unknown): SafeNotificationPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "body,data,tag,title"
    || !bounded(input.title, 320)
    || !bounded(input.body, 960)
    || new TextEncoder().encode(input.body).byteLength > 960
    || !bounded(input.tag, 500)) return undefined;
  const data = validNotificationTarget(input.data);
  return data ? { title: input.title, body: input.body, tag: input.tag, data } : undefined;
}

export function notificationTargetUrl(value: unknown): string | undefined {
  const target = validNotificationTarget(value);
  return target
    ? `/workspace?hostId=${encodeURIComponent(target.hostId)}&piSessionId=${encodeURIComponent(target.piSessionId)}`
    : undefined;
}
