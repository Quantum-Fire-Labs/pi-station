import { describe, expect, it } from "vitest";
import { notificationPresence, notificationTargetUrl, validNotificationPayload, validNotificationTarget } from "./notifications";

describe("notification service-worker values", () => {
  const data = { hostId: "host/one", piSessionId: "session two" };

  it("accepts a strict bounded payload", () => {
    expect(validNotificationPayload({ title: "Pi Station", body: "Done", tag: "turn", data }))
      .toEqual({ title: "Pi Station", body: "Done", tag: "turn", data });
  });

  it("rejects unknown fields and oversized UTF-8 payloads", () => {
    expect(validNotificationPayload({ title: "Pi", body: "Done", tag: "turn", data, extra: true })).toBeUndefined();
    expect(validNotificationPayload({ title: "Pi", body: "😀".repeat(241), tag: "turn", data })).toBeUndefined();
    expect(validNotificationTarget({ ...data, extra: true })).toBeUndefined();
  });

  it("builds the exact cold-start Session URL", () => {
    expect(notificationTargetUrl(data)).toBe("/workspace?hostId=host%2Fone&piSessionId=session%20two");
  });

  it("reports selected visibility separately from mobile pause state", () => {
    const selected = { hostId: "project", piSessionId: "session" } as never;
    expect(notificationPresence(selected, { desktop: true, pauseMobile: true, visible: true })).toMatchObject({
      desktopActive: true,
      visibleSession: { projectId: "project", sessionId: "session" },
    });
    expect(notificationPresence(selected, { desktop: false, pauseMobile: true, visible: false })).not.toHaveProperty("visibleSession");
  });
});
