import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { SessionKey, SessionSummary } from "../application/workspace-model";
import "./agent-attention.css";

export type AgentAttentionStatus = "Failed" | "Unread" | "Working";

export interface AgentAttentionProps {
  /** Sessions from all Workspaces. This component does not reorder this list. */
  readonly sessions: readonly SessionSummary[];
  readonly onSelect: (sessionKey: SessionKey) => void;
  readonly heading?: string;
  readonly emptyLabel?: string;
  readonly persistent?: boolean;
  readonly onRemove?: ((sessionKey: SessionKey) => void) | undefined;
  readonly projects?: readonly { readonly projectId: string; readonly name: string }[];
  readonly selectedSessionKey?: SessionKey | undefined;
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
  readonly expandedIdentities?: ReadonlySet<string>;
  readonly onToggleIdentity?: (sessionIdentity: string, expanded: boolean) => void;
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

export function primaryAgentStatus(session: SessionSummary): AgentAttentionStatus | "Idle" {
  const statuses = agentAttentionStatuses(session);
  if (statuses.includes("Failed")) return "Failed";
  if (statuses.includes("Working")) return "Working";
  if (statuses.includes("Unread")) return "Unread";
  return "Idle";
}

export function agentActivitySessions(sessions: readonly SessionSummary[], selectedSessionKey?: SessionKey, previousOrder: readonly string[] = []): readonly SessionSummary[] {
  const eligible = [...new Map(sessions.map((session) => [keyOf(session.sessionKey), session])).values()]
    .filter((session) => session.quickSession !== true && session.parentSessionKey === undefined)
    .filter((session) => agentAttentionStatuses(session).length > 0 || (selectedSessionKey !== undefined && sameKey(session.sessionKey, selectedSessionKey)));
  const previousPosition = new Map(previousOrder.map((identity, index) => [identity, index]));
  return eligible.sort((left, right) => {
    const leftPosition = previousPosition.get(keyOf(left.sessionKey));
    const rightPosition = previousPosition.get(keyOf(right.sessionKey));
    if (leftPosition !== undefined && rightPosition !== undefined) return leftPosition - rightPosition;
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return 0;
  });
}

export function AgentAttention({ sessions, onSelect, heading = "Agent Activity", projects = [], selectedSessionKey, persistent = false, onRemove }: AgentAttentionProps) {
  const order = useRef<readonly string[]>([]);
  const attention = persistent ? sessions : agentActivitySessions(sessions, selectedSessionKey, order.current);
  order.current = attention.map((session) => keyOf(session.sessionKey));
  const [expanded, setExpanded] = useState(true);
  const headingId = useId();
  const projectNames = new Map(projects.map((project) => [project.projectId, project.name]));
  if (attention.length === 0 && !persistent) return null;

  return (
    <section className="agent-attention" aria-labelledby={persistent ? undefined : headingId} aria-label={persistent ? "Global Sessions" : undefined}>
      <button type="button" className="agent-attention__heading" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}<span id={headingId}>{heading}</span><small>{attention.length}</small>
      </button>
      {expanded && attention.length === 0 && <p className="global-sessions-empty">Open a Session from Projects or start a new one.</p>}
      {expanded && <ul className="agent-attention__list agent-attention__list--activity">
        {attention.map((session) => {
          const projectName = projectNames.get(session.projectId ?? session.sessionKey.hostId);
          const context = projectName ?? session.displayPath?.trim();
          return <li className={persistent ? "global-session-row" : undefined} key={keyOf(session.sessionKey)}><AgentButton session={session} onSelect={onSelect} selected={selectedSessionKey !== undefined && sameKey(session.sessionKey, selectedSessionKey)} {...(context === undefined ? {} : { context })} activity />{onRemove !== undefined && <button type="button" className="global-session-remove" aria-label={`Remove ${sessionAttentionLabel(session)} from Sessions`} title="Remove from list only; the agent and Workspace tabs stay open" onClick={() => onRemove(session.sessionKey)}><X aria-hidden="true" size={14} /></button>}</li>;
        })}
      </ul>}
    </section>
  );
}

export function visibleDelegatedCount(parentSessionKey: SessionKey, sessions: readonly SessionSummary[], expandedIdentities: ReadonlySet<string>): number {
  const visit = (parent: SessionKey, ancestors: ReadonlySet<string>): number => {
    const parentId = keyOf(parent);
    if (!expandedIdentities.has(parentId) || ancestors.has(parentId)) return 0;
    const nextAncestors = new Set(ancestors).add(parentId);
    return directChildren(parent, sessions).reduce((count, child) => count + 1 + visit(child.sessionKey, nextAncestors), 0);
  };
  return visit(parentSessionKey, new Set());
}

export function DelegatedChildren({ parentSessionKey, sessions, onSelect, expanded, onExpandedChange, navigationStartIndex, selectedSessionKey, openSessionIdentities, onCloseTab, expandedIdentities, onToggleIdentity }: DelegatedChildrenProps) {
  const [localExpanded, setLocalExpanded] = useState<ReadonlySet<string>>(() => expanded ? new Set([keyOf(parentSessionKey)]) : new Set());
  const controlled = expandedIdentities ?? (expanded === undefined ? undefined : expanded ? new Set([keyOf(parentSessionKey)]) : new Set<string>());
  const activeExpanded = controlled ?? localExpanded;
  const counter = { value: navigationStartIndex ?? 0 };
  const toggle = (sessionIdentity: string, next: boolean) => {
    if (controlled === undefined) setLocalExpanded((current) => { const result = new Set(current); if (next) result.add(sessionIdentity); else result.delete(sessionIdentity); return result; });
    if (sessionIdentity === keyOf(parentSessionKey)) onExpandedChange?.(next);
    onToggleIdentity?.(sessionIdentity, next);
  };
  return <DelegatedBranch parentSessionKey={parentSessionKey} sessions={sessions} onSelect={onSelect} expandedIdentities={activeExpanded} onToggle={toggle} counter={navigationStartIndex === undefined ? undefined : counter} selectedSessionKey={selectedSessionKey} openSessionIdentities={openSessionIdentities} onCloseTab={onCloseTab} ancestors={new Set()} />;
}

function DelegatedBranch({ parentSessionKey, sessions, onSelect, expandedIdentities, onToggle, counter, selectedSessionKey, openSessionIdentities, onCloseTab, ancestors }: { parentSessionKey: SessionKey; sessions: readonly SessionSummary[]; onSelect: (key: SessionKey) => void; expandedIdentities: ReadonlySet<string>; onToggle: (identity: string, expanded: boolean) => void; counter: { value: number } | undefined; selectedSessionKey: SessionKey | undefined; openSessionIdentities: ReadonlySet<string> | undefined; onCloseTab: ((key: SessionKey) => void) | undefined; ancestors: ReadonlySet<string> }) {
  const parentId = keyOf(parentSessionKey);
  if (ancestors.has(parentId)) return null;
  const children = directChildren(parentSessionKey, sessions).filter((child) => !ancestors.has(keyOf(child.sessionKey)));
  if (children.length === 0) return null;
  const isExpanded = expandedIdentities.has(parentId);
  const working = children.filter((session) => agentAttentionStatuses(session).includes("Working")).length;
  const failed = children.filter((session) => agentAttentionStatuses(session).includes("Failed")).length;
  const summary = [`${children.length} ${children.length === 1 ? "agent" : "agents"}`, working > 0 ? `${working} working` : undefined, failed > 0 ? `${failed} failed` : undefined].filter(Boolean).join(" · ");
  const nextAncestors = new Set(ancestors).add(parentId);
  return <div className="delegated-children">
    <button type="button" className="delegated-children__summary" aria-expanded={isExpanded} onClick={() => onToggle(parentId, !isExpanded)}>{isExpanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}<span>{summary}</span></button>
    {isExpanded && <ul className="agent-attention__list" aria-label="Delegated agents">{children.map((session) => {
      const navigationIndex = counter === undefined ? undefined : counter.value++;
      return <li className="delegated-branch" key={keyOf(session.sessionKey)}><AgentButton session={session} onSelect={onSelect} navigationIndex={navigationIndex} selected={selectedSessionKey !== undefined && sameKey(session.sessionKey, selectedSessionKey)} removable={openSessionIdentities?.has(keyOf(session.sessionKey)) === true} onCloseTab={onCloseTab} /><DelegatedBranch parentSessionKey={session.sessionKey} sessions={sessions} onSelect={onSelect} expandedIdentities={expandedIdentities} onToggle={onToggle} counter={counter} selectedSessionKey={selectedSessionKey} openSessionIdentities={openSessionIdentities} onCloseTab={onCloseTab} ancestors={nextAncestors} /></li>;
    })}</ul>}
  </div>;
}

function directChildren(parentSessionKey: SessionKey, sessions: readonly SessionSummary[]): readonly SessionSummary[] {
  const seen = new Set<string>();
  return sessions.filter((session) => session.parentSessionKey !== undefined && sameKey(session.parentSessionKey, parentSessionKey) && !seen.has(keyOf(session.sessionKey)) && Boolean(seen.add(keyOf(session.sessionKey))));
}

function AgentButton({ session, onSelect, navigationIndex, selected = false, removable = false, onCloseTab, context, activity = false }: { readonly session: SessionSummary; readonly onSelect: (key: SessionKey) => void; readonly navigationIndex?: number | undefined; readonly selected?: boolean; readonly removable?: boolean; readonly onCloseTab?: ((key: SessionKey) => void) | undefined; readonly context?: string; readonly activity?: boolean }) {
  const label = sessionAttentionLabel(session);
  const status = primaryAgentStatus(session);
  return (
    <div className={`${navigationIndex === undefined ? "" : "workspace-tab"}${selected ? " selected" : ""}`}>
      <button className={`agent-attention__agent${activity ? " agent-attention__agent--activity" : ""}${navigationIndex === undefined ? "" : " workspace-tab-open"}`} type="button" onClick={() => onSelect(session.sessionKey)} aria-label={`${label}: ${status}`} aria-current={selected ? "page" : undefined} data-activity-session={activity ? "true" : undefined} data-session-identity={activity || navigationIndex !== undefined ? keyOf(session.sessionKey) : undefined} data-session-shortcut={navigationIndex !== undefined && navigationIndex < 10 ? navigationIndex : undefined} data-unread={(activity || navigationIndex !== undefined) && session.projection.unread.hasUnread ? "true" : undefined}>
        <span className="agent-attention__identity"><span className="agent-attention__name">{label}</span>{context && <small>{context}</small>}</span>
        <span className={`agent-attention__status agent-attention__status--${status.toLowerCase()}`} aria-hidden="true"><i className={`agent-attention__marker agent-attention__marker--${status.toLowerCase()}`} />{status}</span>
      </button>
      {removable && <button type="button" className="workspace-tab-close" aria-label={`Remove ${label} tab`} title="Remove tab (does not close Session)" onClick={() => onCloseTab?.(session.sessionKey)}>×</button>}
    </div>
  );
}

function sameKey(left: SessionKey, right: SessionKey): boolean {
  return left.hostId === right.hostId && left.piSessionId === right.piSessionId;
}

function keyOf(key: SessionKey): string {
  return `${key.hostId}:${key.piSessionId}`;
}
