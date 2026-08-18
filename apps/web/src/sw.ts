/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { notificationTargetUrl, validNotificationPayload, validNotificationTarget } from "./notifications";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> };

void self.skipWaiting();
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), {
  denylist: [/^\/shared\//u],
}));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let value: unknown;
    try { value = event.data?.json(); } catch { return; }
    const payload = validNotificationPayload(value);
    if (!payload) return;
    const options: NotificationOptions & { renotify: boolean } = {
      body: payload.body, tag: payload.tag, renotify: true,
      icon: "/icons/pi-station-192.png", badge: "/icons/pi-station-192.png", data: payload.data,
    };
    await self.registration.showNotification(payload.title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openSession(event.notification.data));
});

export async function openSession(value: unknown): Promise<void> {
  const data = validNotificationTarget(value);
  const target = notificationTargetUrl(value);
  if (!data || !target) return;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = clients.find((client) => {
    try { return new URL(client.url).pathname === "/workspace"; } catch { return false; }
  }) ?? clients[0];
  if (existing) { await existing.navigate(target); await existing.focus(); existing.postMessage({ type: "open-session", hostId: data.hostId, piSessionId: data.piSessionId }); return; }
  await self.clients.openWindow(target);
}
