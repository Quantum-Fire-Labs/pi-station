import { useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Library, Plus, X } from "lucide-react";
import type { SavedWorkspace, SessionKey, SessionSummary } from "../application/workspace-model";

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: "session";
  readonly projectId: string;
  readonly sessionId: string;
}

export type TabbedWorkspace = SavedWorkspace & {
  readonly tabs?: readonly WorkspaceTab[];
  readonly activeTabId?: string;
  readonly closedAt?: string;
};

const identity = (key: SessionKey): string => `${key.hostId}:${key.piSessionId}`;
const label = (session: SessionSummary): string => session.name?.trim() || "Untitled Session";

export function WorkspaceNavigation({ workspace, sessions, selectedSessionKey, onSelectTab, onCloseTab, onOpenSession, onNewSession }: {
  workspace: TabbedWorkspace;
  sessions: readonly SessionSummary[];
  selectedSessionKey?: SessionKey | undefined;
  onSelectTab: (tab: WorkspaceTab, session: SessionSummary) => void;
  onCloseTab: (tab: WorkspaceTab, session?: SessionSummary) => void;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession: () => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.sessionKey.piSessionId, session])), [sessions]);
  const tabs = workspace.tabs ?? [];
  const openIds = new Set(tabs.map(({ sessionId }) => sessionId));
  const savedSessions = sessions
    .filter((session) => session.quickSession !== true && session.parentSessionKey === undefined && !openIds.has(session.sessionKey.piSessionId))
    .sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));

  return <nav className="workspace-navigation" aria-label="Workspace Session tabs">
    <div className="workspace-navigation-heading"><span>Open tabs</span><span>{tabs.length}</span></div>
    <div className="workspace-tab-list">
      {tabs.map((tab, index) => {
        const session = sessionById.get(tab.sessionId);
        const selected = tab.id === workspace.activeTabId || (session !== undefined && selectedSessionKey !== undefined && identity(session.sessionKey) === identity(selectedSessionKey));
        return <div className={`workspace-tab${selected ? " selected" : ""}`} key={tab.id}>
          <button type="button" className="workspace-tab-open" disabled={session === undefined} aria-current={selected ? "page" : undefined} data-session-shortcut={index < 9 ? index + 1 : undefined} onClick={() => { if (session !== undefined) onSelectTab(tab, session); }}>
            {session === undefined ? <i className="session-status-indicator status-idle" aria-label="Missing Session" /> : <SessionDot session={session} />}
            <span><strong>{session === undefined ? "Session unavailable" : label(session)}</strong><small>{session?.displayPath?.split("/").pop() ?? "Missing reference"}</small></span>
          </button>
          <button type="button" className="workspace-tab-close" aria-label={`Remove ${session === undefined ? "unavailable Session" : label(session)} tab`} title="Remove tab (does not close Session)" onClick={() => onCloseTab(tab, session)}><X aria-hidden="true" size={14} /></button>
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

function SessionDot({ session }: { session: SessionSummary }) {
  const status = session.projection.run === "working" ? "working" : session.projection.unread.hasUnread ? "unread" : "idle";
  return <i className={`session-status-indicator status-${status}`} aria-label={`${status[0]?.toUpperCase()}${status.slice(1)} Session`} style={{ "--session-depth": 0 } as CSSProperties} />;
}
