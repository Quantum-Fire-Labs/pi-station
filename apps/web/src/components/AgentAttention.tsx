import { useId, useState } from "react";
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
  readonly onExpandedChange?: (expanded: boolean) => void;
  readonly navigationStartIndex?: number;
  readonly selectedSessionKey?: SessionKey | undefined;
  readonly openSessionIdentities?: ReadonlySet<string>;
  readonly onCloseTab?: (sessionKey: SessionKey) => void;
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

export function DelegatedChildren({ parentSessionKey, sessions, onSelect, expanded, onExpandedChange, navigationStartIndex, selectedSessionKey, openSessionIdentities, onCloseTab }: DelegatedChildrenProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;
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
      <button type="button" className="delegated-children__summary" aria-expanded={isExpanded} onClick={() => {
        const next = !isExpanded;
        if (expanded === undefined) setLocalExpanded(next);
        onExpandedChange?.(next);
      }}>{summary}</button>
      {isExpanded ? (
        <ul className="agent-attention__list" aria-label="Delegated agents">
          {children.map((session, index) => <AgentButton key={keyOf(session.sessionKey)} session={session} onSelect={onSelect} navigationIndex={navigationStartIndex === undefined ? undefined : navigationStartIndex + index} selected={selectedSessionKey !== undefined && sameKey(session.sessionKey, selectedSessionKey)} removable={openSessionIdentities?.has(keyOf(session.sessionKey)) === true} onCloseTab={onCloseTab} />)}
        </ul>
      ) : null}
    </div>
  );
}

function AgentButton({ session, onSelect, navigationIndex, selected = false, removable = false, onCloseTab }: { readonly session: SessionSummary; readonly onSelect: (key: SessionKey) => void; readonly navigationIndex?: number | undefined; readonly selected?: boolean; readonly removable?: boolean; readonly onCloseTab?: ((key: SessionKey) => void) | undefined }) {
  const statuses = agentAttentionStatuses(session);
  const label = sessionAttentionLabel(session);
  const statusText = statuses.length > 0 ? statuses.join(", ") : "Idle";
  return (
    <li className={`${navigationIndex === undefined ? "" : "workspace-tab"}${selected ? " selected" : ""}`}>
      <button className={`agent-attention__agent${navigationIndex === undefined ? "" : " workspace-tab-open"}`} type="button" onClick={() => onSelect(session.sessionKey)} aria-label={`${label}: ${statusText}`} aria-current={selected ? "page" : undefined} data-session-identity={navigationIndex === undefined ? undefined : keyOf(session.sessionKey)} data-session-shortcut={navigationIndex !== undefined && navigationIndex < 10 ? navigationIndex : undefined} data-unread={navigationIndex !== undefined && session.projection.unread.hasUnread ? "true" : undefined}>
        <span className="agent-attention__name">{label}</span>
        <span className="agent-attention__statuses" aria-hidden="true">
          {statuses.length > 0 ? statuses.map((status) => <span className={`agent-attention__status agent-attention__status--${status.toLowerCase()}`} key={status}>{status}</span>) : <span className="agent-attention__status">Idle</span>}
        </span>
      </button>
      {removable && <button type="button" className="workspace-tab-close" aria-label={`Remove ${label} tab`} title="Remove tab (does not close Session)" onClick={() => onCloseTab?.(session.sessionKey)}>×</button>}
    </li>
  );
}

function sameKey(left: SessionKey, right: SessionKey): boolean {
  return left.hostId === right.hostId && left.piSessionId === right.piSessionId;
}

function keyOf(key: SessionKey): string {
  return `${key.hostId}:${key.piSessionId}`;
}
