import type { SessionSummary } from "../application/workspace-model";

export function sessionActivityTime(session: SessionSummary): number {
  const time = Date.parse(session.lastActivityAt ?? session.createdAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

export function sessionWorkStatus(session: SessionSummary): string {
  const availability = session.projection.availability;
  if (availability === "reconnecting") return "Reconnecting";
  if (availability !== "available" && availability !== "closed") return "Unavailable";
  if (availability === "available" && (session.projection.run === "working" || session.delegationStatus === "working")) return "Working";
  if (session.projection.synchronization === "failed" || session.delegationStatus === "failed") return "Failed";
  if (session.projection.unread.hasUnread) return "Unread";
  if (session.projection.availability === "closed") return "Closed";
  if (session.projection.availability !== "available") return "Unavailable";
  return "Idle";
}

export function activityDate(time: number): string {
  return time === 0 ? "No recorded activity" : new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
