import { describe, expect, it } from "vitest";
import { fixtureState } from "../fixtures/workspace";
import { activityDate, sessionActivityTime, sessionWorkStatus } from "./project-work-summary";

const session = fixtureState.sessions[0]!;
describe("Project work summaries", () => {
  it("uses recorded activity and handles missing or invalid timestamps", () => {
    expect(sessionActivityTime({ ...session, lastActivityAt: "invalid" })).toBe(0);
    expect(sessionActivityTime({ ...session, lastActivityAt: "2026-09-01T00:00:00Z" })).toBe(Date.parse("2026-09-01T00:00:00Z"));
    expect(activityDate(0)).toBe("No recorded activity");
  });
  it("keeps unread and failed information instead of reporting every completed Session as Idle", () => {
    const completed = { ...session, projection: { ...session.projection, run: "idle" as const, unread: { hasUnread: true } } };
    expect(sessionWorkStatus(completed)).toBe("Unread");
    expect(sessionWorkStatus({ ...completed, projection: { ...completed.projection, availability: "closed" } })).toBe("Unread");
    expect(sessionWorkStatus({ ...completed, projection: { ...completed.projection, synchronization: "failed" } })).toBe("Failed");
    expect(sessionWorkStatus({ ...completed, projection: { ...completed.projection, run: "working" } })).toBe("Working");
  });
});
