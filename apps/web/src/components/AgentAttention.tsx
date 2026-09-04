import { useId } from "react";
import type { SessionKey, SessionSummary } from "../application/workspace-model";
import "./agent-attention.css";

export type AgentAttentionStatus = "Failed" | "Unread" | "Working";

export interface AgentAttentionProps {
  /** Sessions from all Workspaces. This component does not reorder this list. */
  readonly sessions: readonly SessionSummary[];
  readonly onSelect: (sessionKey: SessionKey) => void;
  readonly heading?: string;
  readonly emptyLabel?: string;
}

export interface DelegatedChildrenProps {
  readonly parentSessionKey: SessionKey;
  readonly sessions: readonly SessionSummary[];
  readonly onSelect: (sessionKey: SessionKey) => void;
  readonly expanded?: boolean;
}

export function agentAttentionStatuses(session: SessionSummary): readonly AgentAttentionStatus[] {
  const statuses: AgentAttentionStatus[] = [];
  if (session.delegationStatus === "failed" || session.projection.synchronization === "failed") statuses.push("Failed");
  if (session.projection.unread.hasUnread) statuses.push("Unread");
  if (session.delegationStatus === "working" || session.projection.run === "working") statuses.push("Working");
  return statuses;
}

export function sessionAttentionLabel(session: SessionSummary): string {
  return session.name?.trim() || session.displayPath?.trim() || session.sessionKey.piSessionId;
}

export function AgentAttention({
  sessions,
  onSelect,
  heading = "Needs attention",
  emptyLabel = "No agents need attention",
}: AgentAttentionProps) {
  const attention = sessions.filter((session) => agentAttentionStatuses(session).length > 0);
  const headingId = useId();

  return (
    <section className="agent-attention" aria-labelledby={headingId}>
      <h2 id={headingId} className="agent-attention__heading">{heading}</h2>
      {attention.length === 0 ? <p className="agent-attention__empty">{emptyLabel}</p> : (
        <ul className="agent-attention__list">
          {attention.map((session) => <AgentButton key={keyOf(session.sessionKey)} session={session} onSelect={onSelect} />)}
        </ul>
      )}
    </section>
  );
}

export function DelegatedChildren({ parentSessionKey, sessions, onSelect, expanded = true }: DelegatedChildrenProps) {
  const children = sessions.filter((session) => session.parentSessionKey !== undefined && sameKey(session.parentSessionKey, parentSessionKey));
  if (children.length === 0) return null;

  const working = children.filter((session) => agentAttentionStatuses(session).includes("Working")).length;
  const failed = children.filter((session) => agentAttentionStatuses(session).includes("Failed")).length;
  const summary = [
    `${children.length} ${children.length === 1 ? "agent" : "agents"}`,
    working > 0 ? `${working} working` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <div className="delegated-children">
      <p className="delegated-children__summary">{summary}</p>
      {expanded ? (
        <ul className="agent-attention__list" aria-label="Delegated agents">
          {children.map((session) => <AgentButton key={keyOf(session.sessionKey)} session={session} onSelect={onSelect} />)}
        </ul>
      ) : null}
    </div>
  );
}

function AgentButton({ session, onSelect }: { readonly session: SessionSummary; readonly onSelect: (key: SessionKey) => void }) {
  const statuses = agentAttentionStatuses(session);
  const label = sessionAttentionLabel(session);
  const statusText = statuses.length > 0 ? statuses.join(", ") : "Idle";
  return (
    <li>
      <button className="agent-attention__agent" type="button" onClick={() => onSelect(session.sessionKey)} aria-label={`${label}: ${statusText}`}>
        <span className="agent-attention__name">{label}</span>
        <span className="agent-attention__statuses" aria-hidden="true">
          {statuses.length > 0 ? statuses.map((status) => <span className={`agent-attention__status agent-attention__status--${status.toLowerCase()}`} key={status}>{status}</span>) : <span className="agent-attention__status">Idle</span>}
        </span>
      </button>
    </li>
  );
}

function sameKey(left: SessionKey, right: SessionKey): boolean {
  return left.hostId === right.hostId && left.piSessionId === right.piSessionId;
}

function keyOf(key: SessionKey): string {
  return `${key.hostId}:${key.piSessionId}`;
}
