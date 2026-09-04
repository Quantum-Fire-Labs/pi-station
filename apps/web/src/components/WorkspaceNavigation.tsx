import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Library, Plus, X } from "lucide-react";
import type { Workspace, WorkspaceSessionTab } from "@pi-station/application-protocol";
import type { ProjectSummary, SessionKey, SessionSummary } from "../application/workspace-model";
import { DelegatedChildren } from "./AgentAttention";
import "./workspace-navigation.css";

const identity = (key: SessionKey): string => `${key.hostId}:${key.piSessionId}`;
const tabIdentity = (projectId: string | undefined, sessionId: string): string => `${projectId ?? ""}:${sessionId}`;
const label = (session: SessionSummary): string => session.name?.trim() || "Untitled Session";
const collapseStorageKey = (workspaceId: string): string => `pi-station:workspace-navigation:${workspaceId}:collapsed-projects`;

interface ProjectGroup {
  readonly projectId: string;
  readonly project: ProjectSummary | undefined;
  readonly tabs: readonly WorkspaceSessionTab[];
}

export function groupWorkspaceTabs(tabs: readonly WorkspaceSessionTab[], projects: readonly ProjectSummary[]): readonly ProjectGroup[] {
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const groups = new Map<string, WorkspaceSessionTab[]>();
  for (const tab of tabs) {
    const projectId = tab.projectId ?? "";
    const group = groups.get(projectId);
    if (group === undefined) groups.set(projectId, [tab]);
    else group.push(tab);
  }
  return [...groups].map(([projectId, groupTabs]) => ({ projectId, project: projectById.get(projectId), tabs: groupTabs }));
}

export function WorkspaceNavigation({ workspace, projects, sessions, selectedSessionKey, onSelectTab, onCloseTab, onOpenSession, onNewSession, onNewSessionInProject }: {
  workspace: Workspace;
  projects: readonly ProjectSummary[];
  sessions: readonly SessionSummary[];
  selectedSessionKey?: SessionKey | undefined;
  onSelectTab: (tab: WorkspaceSessionTab, session: SessionSummary) => void;
  onCloseTab: (tab: WorkspaceSessionTab, session?: SessionSummary) => void;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession: () => void;
  onNewSessionInProject?: (project: ProjectSummary) => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expandedDelegations, setExpandedDelegations] = useState<ReadonlySet<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => readCollapsed(workspace.id));
  const sessionById = useMemo(() => new Map(sessions.map((session) => [identity(session.sessionKey), session])), [sessions]);
  const groups = useMemo(() => groupWorkspaceTabs(workspace.tabs, projects), [workspace.tabs, projects]);
  const selectedIdentity = selectedSessionKey === undefined ? undefined : identity(selectedSessionKey);
  const selectedSession = selectedIdentity === undefined ? undefined : sessionById.get(selectedIdentity);
  const selectedTabId = selectedSession === undefined
    ? workspace.activeTabId
    : workspace.tabs.find((tab) => tabIdentity(tab.projectId, tab.sessionId) === selectedIdentity)?.id;
  const selectedProjectId = workspace.tabs.find((tab) => tab.id === selectedTabId)?.projectId ?? selectedSession?.projectId;

  useEffect(() => {
    setCollapsedProjects(readCollapsed(workspace.id));
    setExpandedDelegations(new Set());
  }, [workspace.id]);
  useEffect(() => {
    if (selectedProjectId === undefined) return;
    setCollapsedProjects((current) => {
      if (!current.has(selectedProjectId)) return current;
      const next = new Set(current);
      next.delete(selectedProjectId);
      writeCollapsed(workspace.id, next);
      return next;
    });
  }, [selectedIdentity, selectedProjectId, workspace.id]);
  useEffect(() => {
    if (selectedSession?.parentSessionKey === undefined) return;
    setExpandedDelegations((current) => new Set(current).add(identity(selectedSession.parentSessionKey!)));
  }, [selectedIdentity, selectedSession]);

  const openIds = new Set(workspace.tabs.map(({ projectId, sessionId }) => tabIdentity(projectId, sessionId)));
  const savedSessions = sessions
    .filter((session) => session.quickSession !== true && session.parentSessionKey === undefined && !openIds.has(identity(session.sessionKey)))
    .sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
  let visibleIndex = 0;

  const toggleProject = (projectId: string) => setCollapsedProjects((current) => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
    writeCollapsed(workspace.id, next);
    return next;
  });

  return <nav className="workspace-navigation" aria-label="Workspace Session tabs">
    <div className="workspace-navigation-heading"><span>Open tabs</span><span>{workspace.tabs.length}</span></div>
    <div className="workspace-tab-list">
      {groups.map((group) => {
        const collapsed = collapsedProjects.has(group.projectId);
        const projectLabel = group.project?.name ?? (group.projectId ? `Unknown Project (${group.projectId})` : "Project unavailable");
        const activity = groupActivity(group.tabs, sessionById, sessions);
        return <section className="workspace-project-group" key={group.projectId || "missing-project"}>
          <div className="workspace-project-heading">
            <button type="button" className="workspace-project-toggle" aria-expanded={!collapsed} onClick={() => toggleProject(group.projectId)}>
              {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
              <span>{projectLabel}</span>
              {collapsed && activity.length > 0 && <small>{activity.join(" · ")}</small>}
            </button>
            {group.project !== undefined && <button type="button" className="workspace-project-new" aria-label={`New Session in ${projectLabel}`} disabled={onNewSessionInProject === undefined} onClick={() => onNewSessionInProject?.(group.project!)}><Plus aria-hidden="true" size={16} /></button>}
          </div>
          {!collapsed && <div className="workspace-project-tabs">
            {group.tabs.map((tab) => {
              const session = sessionById.get(tabIdentity(tab.projectId, tab.sessionId));
              const selected = tab.id === selectedTabId;
              const shortcut = session === undefined ? undefined : ++visibleIndex;
              const parentIdentity = session === undefined ? undefined : identity(session.sessionKey);
              const children = session === undefined ? [] : sessions.filter((candidate) => candidate.parentSessionKey !== undefined && identity(candidate.parentSessionKey) === parentIdentity);
              const delegationExpanded = parentIdentity !== undefined && expandedDelegations.has(parentIdentity);
              const childStartIndex = visibleIndex + 1;
              if (delegationExpanded) visibleIndex += children.length;
              return <div className={`workspace-tab${selected ? " selected" : ""}`} key={tab.id}>
                <button type="button" className="workspace-tab-open" disabled={session === undefined} aria-current={selected ? "page" : undefined} data-session-shortcut={shortcut !== undefined && shortcut < 10 ? shortcut : undefined} data-unread={session?.projection.unread.hasUnread === true ? "true" : undefined} data-session-identity={session === undefined ? undefined : identity(session.sessionKey)} onClick={() => { if (session !== undefined) onSelectTab(tab, session); }}>
                  {session === undefined ? <i className="session-status-indicator status-idle" aria-label="Missing Session" /> : <SessionDot session={session} />}
                  <span><strong>{session === undefined ? "Session unavailable" : label(session)}</strong>{session === undefined ? <small>Referenced Session was not found.</small> : <SessionStatus session={session} />}</span>
                </button>
                <button type="button" className="workspace-tab-close" aria-label={`Remove ${session === undefined ? "unavailable Session" : label(session)} tab`} title="Remove tab (does not close Session)" onClick={() => onCloseTab(tab, session)}><X aria-hidden="true" size={14} /></button>
                {session !== undefined && <DelegatedChildren parentSessionKey={session.sessionKey} sessions={sessions} onSelect={(key) => { const child = sessionById.get(identity(key)); if (child !== undefined) onOpenSession(child); }} expanded={delegationExpanded} navigationStartIndex={childStartIndex} onExpandedChange={(expanded) => setExpandedDelegations((current) => { const next = new Set(current); if (expanded) next.add(identity(session.sessionKey)); else next.delete(identity(session.sessionKey)); return next; })} />}
              </div>;
            })}
          </div>}
        </section>;
      })}
      {workspace.tabs.length === 0 && <p className="workspace-tabs-empty">No open tabs</p>}
    </div>
    <button type="button" className="workspace-navigation-action" onClick={onNewSession}><Plus aria-hidden="true" size={15} />New Session</button>
    <button type="button" className="workspace-navigation-action" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}>
      {libraryOpen ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}<Library aria-hidden="true" size={15} />Open saved Session
    </button>
    {libraryOpen && <div className="workspace-session-library" role="list" aria-label="Saved Sessions">
      {savedSessions.map((session) => <button type="button" role="listitem" aria-label={`Open ${label(session)}`} key={identity(session.sessionKey)} onClick={() => onOpenSession(session)}><SessionDot session={session} /><span>{label(session)}</span><small>{projects.find(({ projectId }) => projectId === session.projectId)?.name ?? "Project unavailable"}</small></button>)}
      {savedSessions.length === 0 && <p>No saved Sessions to open.</p>}
    </div>}
  </nav>;
}

function readCollapsed(workspaceId: string): ReadonlySet<string> {
  try {
    const value = window.localStorage.getItem(collapseStorageKey(workspaceId));
    if (value === null) return new Set();
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch { return new Set(); }
}

function writeCollapsed(workspaceId: string, projects: ReadonlySet<string>): void {
  try { window.localStorage.setItem(collapseStorageKey(workspaceId), JSON.stringify([...projects])); } catch { /* Browser view state can be unavailable. */ }
}

function groupActivity(tabs: readonly WorkspaceSessionTab[], sessionById: ReadonlyMap<string, SessionSummary>, sessions: readonly SessionSummary[]): readonly string[] {
  const included = new Set<string>();
  const addDescendants = (key: SessionKey) => {
    const id = identity(key);
    if (included.has(id)) return;
    included.add(id);
    sessions.filter((session) => session.parentSessionKey !== undefined && identity(session.parentSessionKey) === id).forEach((session) => addDescendants(session.sessionKey));
  };
  tabs.forEach((tab) => { const session = sessionById.get(tabIdentity(tab.projectId, tab.sessionId)); if (session !== undefined) addDescendants(session.sessionKey); });
  const relevant = [...new Map(sessions.filter((session) => included.has(identity(session.sessionKey))).map((session) => [identity(session.sessionKey), session])).values()];
  const working = relevant.filter((session) => statuses(session).includes("Working")).length;
  const unread = relevant.filter((session) => statuses(session).includes("Unread")).length;
  return [working > 0 ? `${working} working` : undefined, unread > 0 ? `${unread} unread` : undefined].filter((value): value is string => value !== undefined);
}

function statuses(session: SessionSummary): readonly string[] {
  return [session.projection.availability === "closed" ? "Closed" : undefined, session.delegationStatus === "failed" || session.projection.synchronization === "failed" ? "Failed" : undefined, session.projection.run === "working" || session.delegationStatus === "working" ? "Working" : undefined, session.projection.unread.hasUnread ? "Unread" : undefined].filter((status): status is string => status !== undefined);
}
function SessionStatus({ session }: { session: SessionSummary }) { const values = statuses(session); return <small className="workspace-tab-status">{values.length === 0 ? "Idle" : values.join(" · ")}</small>; }
function SessionDot({ session }: { session: SessionSummary }) { const values = statuses(session); const status = values.includes("Failed") ? "failed" : values.includes("Working") ? "working" : values.includes("Unread") ? "unread" : "idle"; return <i className={`session-status-indicator status-${status}`} aria-label={`${values.length === 0 ? "Idle" : values.join(", ")} Session`} style={{ "--session-depth": 0 } as CSSProperties} />; }
