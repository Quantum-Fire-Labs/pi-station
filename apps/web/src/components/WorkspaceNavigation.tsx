import { useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Library, Plus, X } from "lucide-react";
import type { Workspace, WorkspaceSessionTab } from "@pi-station/application-protocol";
import type { ProjectSummary, SessionKey, SessionSummary } from "../application/workspace-model";
import { DelegatedChildren } from "./AgentAttention";


const identity = (key: SessionKey): string => `${key.hostId}:${key.piSessionId}`;
const label = (session: SessionSummary): string => session.name?.trim() || "Untitled Session";

export function WorkspaceNavigation({ workspace, projects, sessions, selectedSessionKey, onSelectTab, onCloseTab, onOpenSession, onNewSession }: {
  workspace: Workspace;
  projects: readonly ProjectSummary[];
  sessions: readonly SessionSummary[];
  selectedSessionKey?: SessionKey | undefined;
  onSelectTab: (tab: WorkspaceSessionTab, session: SessionSummary) => void;
  onCloseTab: (tab: WorkspaceSessionTab, session?: SessionSummary) => void;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession: () => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [tabIdentity(session.projectId, session.sessionKey.piSessionId), session])), [sessions]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.projectId, project.name])), [projects]);
  const tabs = workspace.tabs;
  const openIds = new Set(tabs.map(({ projectId, sessionId }) => tabIdentity(projectId, sessionId)));
  const selectedSession = selectedSessionKey === undefined ? undefined : sessions.find((session) => identity(session.sessionKey) === identity(selectedSessionKey));
  const selectedTabId = selectedSession === undefined
    ? workspace.activeTabId
    : tabs.find((tab) => tabIdentity(tab.projectId, tab.sessionId) === tabIdentity(selectedSession.projectId, selectedSession.sessionKey.piSessionId))?.id;
  const savedSessions = sessions
    .filter((session) => session.quickSession !== true && session.parentSessionKey === undefined && !openIds.has(tabIdentity(session.projectId, session.sessionKey.piSessionId)))
    .sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));

  return <nav className="workspace-navigation" aria-label="Workspace Session tabs">
    <div className="workspace-navigation-heading"><span>Open tabs</span><span>{tabs.length}</span></div>
    <div className="workspace-tab-list">
      {tabs.map((tab, index) => {
        const session = sessionById.get(tabIdentity(tab.projectId, tab.sessionId));
        const selected = tab.id === selectedTabId;
        const projectLabel = projectById.get(tab.projectId) ?? `Unknown Project (${tab.projectId})`;
        return <div className={`workspace-tab${selected ? " selected" : ""}`} key={tab.id}>
          <button type="button" className="workspace-tab-open" disabled={session === undefined} aria-current={selected ? "page" : undefined} data-session-shortcut={index < 9 ? index + 1 : undefined} data-session-identity={session === undefined ? undefined : identity(session.sessionKey)} onClick={() => { if (session !== undefined) onSelectTab(tab, session); }}>
            {session === undefined ? <i className="session-status-indicator status-idle" aria-label="Missing Session" /> : <SessionDot session={session} />}
            <span><strong>{session === undefined ? "Session unavailable" : label(session)}</strong><small>{projectLabel}</small>{session === undefined ? <small>Referenced Session was not found.</small> : <SessionStatus session={session} />}</span>
          </button>
          <button type="button" className="workspace-tab-close" aria-label={`Remove ${session === undefined ? "unavailable Session" : label(session)} tab`} title="Remove tab (does not close Session)" onClick={() => onCloseTab(tab, session)}><X aria-hidden="true" size={14} /></button>
          {session !== undefined && <DelegatedChildren parentSessionKey={session.sessionKey} sessions={sessions} onSelect={(key) => {
            const child = sessions.find((candidate) => identity(candidate.sessionKey) === identity(key));
            if (child !== undefined) onOpenSession(child);
          }} expanded={false} />}
        </div>;
      })}
      {tabs.length === 0 && <p className="workspace-tabs-empty">No open tabs</p>}
    </div>
    <button type="button" className="workspace-navigation-action" onClick={onNewSession}><Plus aria-hidden="true" size={15} />New Session</button>
    <button type="button" className="workspace-navigation-action" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}>
      {libraryOpen ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}<Library aria-hidden="true" size={15} />Open saved Session
    </button>
    {libraryOpen && <div className="workspace-session-library" role="list" aria-label="Saved Sessions">
      {savedSessions.map((session) => <button type="button" role="listitem" aria-label={`Open ${label(session)}`} key={identity(session.sessionKey)} onClick={() => onOpenSession(session)}><SessionDot session={session} /><span>{label(session)}</span><small>{session.displayPath?.split("/").pop()}</small></button>)}
      {savedSessions.length === 0 && <p>No saved Sessions to open.</p>}
    </div>}
  </nav>;
}

const tabIdentity = (projectId: string | undefined, sessionId: string): string => `${projectId ?? ""}\0${sessionId}`;

function statuses(session: SessionSummary): readonly string[] {
  return [
    session.delegationStatus === "failed" || session.projection.synchronization === "failed" ? "Failed" : undefined,
    session.projection.run === "working" || session.delegationStatus === "working" ? "Working" : undefined,
    session.projection.unread.hasUnread ? "Unread" : undefined,
  ].filter((status): status is string => status !== undefined);
}

function SessionStatus({ session }: { session: SessionSummary }) {
  const values = statuses(session);
  return <small className="workspace-tab-status">{values.length === 0 ? "Idle" : values.join(" · ")}</small>;
}

function SessionDot({ session }: { session: SessionSummary }) {
  const values = statuses(session);
  const status = values.includes("Failed") ? "failed" : values.includes("Working") ? "working" : values.includes("Unread") ? "unread" : "idle";
  return <i className={`session-status-indicator status-${status}`} aria-label={`${values.length === 0 ? "Idle" : values.join(", ")} Session`} style={{ "--session-depth": 0 } as CSSProperties} />;
}
