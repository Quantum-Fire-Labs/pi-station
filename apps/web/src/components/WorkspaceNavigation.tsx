import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Library, MoreHorizontal, Plus, X } from "lucide-react";
import type { Workspace, WorkspaceSessionTab } from "@pi-station/application-protocol";
import type { ProjectSummary, SessionKey, SessionSummary } from "../application/workspace-model";
import { DelegatedChildren, visibleDelegatedCount } from "./AgentAttention";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import "./workspace-navigation.css";

const identity = (key: SessionKey): string => `${key.hostId}:${key.piSessionId}`;
const tabIdentity = (projectId: string | undefined, sessionId: string): string => `${projectId ?? ""}:${sessionId}`;
const label = (session: SessionSummary): string => session.name?.trim() || "Untitled Session";
const collapseStorageKey = (workspaceId: string): string => `pi-station:workspace-navigation:${workspaceId}:collapsed-projects`;

interface ProjectGroup {
  readonly key: string;
  readonly projectId: string;
  readonly project?: ProjectSummary;
  readonly directory?: string;
  readonly tabs: readonly WorkspaceSessionTab[];
}

export function groupWorkspaceTabs(tabs: readonly WorkspaceSessionTab[], projects: readonly ProjectSummary[], sessions: readonly SessionSummary[] = []): readonly ProjectGroup[] {
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const sessionById = new Map(sessions.map((session) => [identity(session.sessionKey), session]));
  const groups = new Map<string, { projectId: string; project?: ProjectSummary; directory?: string; tabs: WorkspaceSessionTab[] }>();
  for (const tab of tabs) {
    const project = projectById.get(tab.projectId);
    const directory = project === undefined ? sessionById.get(tabIdentity(tab.projectId, tab.sessionId))?.displayPath : undefined;
    const key = project === undefined && directory !== undefined ? `directory:${directory}` : `project:${tab.projectId}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { projectId: tab.projectId, ...(project === undefined ? {} : { project }), ...(directory === undefined ? {} : { directory }), tabs: [tab] });
    else group.tabs.push(tab);
  }
  return [...groups].map(([key, group]) => ({ key, ...group }));
}

export function WorkspaceNavigation({ workspace, projects, sessions, selectedSessionKey, onSelectTab, onCloseTab, onOpenSession, onNewSessionInProject, onCloseProjectTabs, onAddDirectoryAsProject }: {
  workspace: Workspace;
  projects: readonly ProjectSummary[];
  sessions: readonly SessionSummary[];
  selectedSessionKey?: SessionKey | undefined;
  onSelectTab: (tab: WorkspaceSessionTab, session: SessionSummary) => void;
  onCloseTab: (tab: WorkspaceSessionTab, session?: SessionSummary) => void;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession?: () => void;
  onNewSessionInProject?: (project: ProjectSummary) => void;
  onCloseProjectTabs?: (project: ProjectSummary) => void;
  onAddDirectoryAsProject?: (directory: string) => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expandedDelegations, setExpandedDelegations] = useState<ReadonlySet<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => readCollapsed(workspace.id));
  const sessionById = useMemo(() => new Map(sessions.map((session) => [identity(session.sessionKey), session])), [sessions]);
  const groups = useMemo(() => groupWorkspaceTabs(workspace.tabs, projects, sessions), [workspace.tabs, projects, sessions]);
  const selectedIdentity = selectedSessionKey === undefined ? undefined : identity(selectedSessionKey);
  const requestedSelectedSession = selectedIdentity === undefined ? undefined : sessionById.get(selectedIdentity);
  const selectedTabId = requestedSelectedSession === undefined
    ? workspace.activeTabId
    : workspace.tabs.find((tab) => tabIdentity(tab.projectId, tab.sessionId) === selectedIdentity)?.id;
  const selectedTab = workspace.tabs.find((tab) => tab.id === selectedTabId);
  const selectedSession = requestedSelectedSession ?? (selectedTab === undefined ? undefined : sessionById.get(tabIdentity(selectedTab.projectId, selectedTab.sessionId)));
  const selectedProjectId = selectedTab?.projectId ?? selectedSession?.projectId;
  const selectedAncestorIdentities: string[] = [];
  const ancestorGuard = new Set<string>();
  let ancestorKey = selectedSession?.parentSessionKey;
  while (ancestorKey !== undefined && !ancestorGuard.has(identity(ancestorKey))) {
    const ancestorIdentity = identity(ancestorKey);
    selectedAncestorIdentities.push(ancestorIdentity);
    ancestorGuard.add(ancestorIdentity);
    ancestorKey = sessionById.get(ancestorIdentity)?.parentSessionKey;
  }
  const selectedAncestorsKey = selectedAncestorIdentities.join("|");

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
    if (selectedAncestorIdentities.length === 0) return;
    setExpandedDelegations((current) => {
      if (selectedAncestorIdentities.every((ancestor) => current.has(ancestor))) return current;
      return new Set([...current, ...selectedAncestorIdentities]);
    });
  }, [selectedIdentity, selectedAncestorsKey, workspace.id]);

  const openIds = new Set(workspace.tabs.map(({ projectId, sessionId }) => tabIdentity(projectId, sessionId)));
  const openTabByIdentity = new Map(workspace.tabs.map((tab) => [tabIdentity(tab.projectId, tab.sessionId), tab]));
  const nestedTabIds = new Set(workspace.tabs.flatMap((tab) => {
    const session = sessionById.get(tabIdentity(tab.projectId, tab.sessionId));
    const visited = new Set<string>();
    let parentKey = session?.parentSessionKey;
    while (parentKey !== undefined && !visited.has(identity(parentKey))) {
      const parentIdentity = identity(parentKey);
      if (openIds.has(parentIdentity)) return [tab.id];
      visited.add(parentIdentity);
      parentKey = sessionById.get(parentIdentity)?.parentSessionKey;
    }
    return [];
  }));
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
    <div className="workspace-tab-list">
      {groups.map((group) => {
        const visibleTabs = group.tabs.filter((tab) => !nestedTabIds.has(tab.id));
        if (visibleTabs.length === 0) return null;
        const collapsed = collapsedProjects.has(group.projectId);
        const projectLabel = group.project?.name ?? (group.directory === undefined ? "Directory unavailable" : directoryName(group.directory));
        const activity = groupActivity(group.tabs, sessionById, sessions);
        return <section className="workspace-project-group" key={group.key}>
          <div className="workspace-project-heading">
            <button type="button" className="workspace-project-toggle" aria-expanded={!collapsed} onClick={() => toggleProject(group.projectId)}>
              {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
              <span title={group.directory}>{projectLabel}</span>
              {collapsed && activity.length > 0 && <small>{activity.join(" · ")}</small>}
            </button>
            {group.project !== undefined ? <>
              <button type="button" className="workspace-project-new" aria-label={`New Session in ${projectLabel}`} disabled={onNewSessionInProject === undefined} onClick={() => onNewSessionInProject?.(group.project!)}><Plus aria-hidden="true" size={16} /></button>
              <DropdownMenu><DropdownMenuTrigger className="workspace-project-menu" aria-label={`Actions for ${projectLabel}`}><MoreHorizontal aria-hidden="true" size={16} /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onCloseProjectTabs?.(group.project!)} disabled={onCloseProjectTabs === undefined}>Close project tabs</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </> : group.directory !== undefined && <DropdownMenu><DropdownMenuTrigger className="workspace-project-menu" aria-label={`Actions for ${projectLabel}`}><MoreHorizontal aria-hidden="true" size={16} /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onAddDirectoryAsProject?.(group.directory!)} disabled={onAddDirectoryAsProject === undefined}>Add as Project</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
          </div>
          {!collapsed && <div className="workspace-project-tabs">
            {visibleTabs.map((tab) => {
              const session = sessionById.get(tabIdentity(tab.projectId, tab.sessionId));
              const selected = tab.id === selectedTabId;
              const shortcut = session === undefined ? undefined : ++visibleIndex;
              const childStartIndex = visibleIndex + 1;
              if (session !== undefined) visibleIndex += visibleDelegatedCount(session.sessionKey, sessions, expandedDelegations);
              return <div className="workspace-session-branch" key={tab.id}>
                <div className={`workspace-tab${selected ? " selected" : ""}`}>
                <button type="button" className="workspace-tab-open" disabled={session === undefined} aria-current={selected ? "page" : undefined} data-session-shortcut={shortcut !== undefined && shortcut < 10 ? shortcut : undefined} data-unread={session?.projection.unread.hasUnread === true ? "true" : undefined} data-session-identity={session === undefined ? undefined : identity(session.sessionKey)} onClick={() => { if (session !== undefined) onSelectTab(tab, session); }}>
                  {session === undefined ? <i className="session-status-indicator status-idle" aria-label="Missing Session" /> : <SessionDot session={session} />}
                  <span><strong>{session === undefined ? "Session unavailable" : label(session)}</strong>{session === undefined ? <small>Referenced Session was not found.</small> : <SessionStatus session={session} />}</span>
                </button>
                <button type="button" className="workspace-tab-close" aria-label={`Remove ${session === undefined ? "unavailable Session" : label(session)} tab`} title="Remove tab (does not close Session)" onClick={() => onCloseTab(tab, session)}><X aria-hidden="true" size={14} /></button>
                </div>
                {session !== undefined && <DelegatedChildren parentSessionKey={session.sessionKey} sessions={sessions} onSelect={(key) => { const child = sessionById.get(identity(key)); if (child !== undefined) onOpenSession(child); }} expandedIdentities={expandedDelegations} navigationStartIndex={childStartIndex} selectedSessionKey={selectedSession?.sessionKey} openSessionIdentities={openIds} onCloseTab={(key) => { const childTab = openTabByIdentity.get(identity(key)); const child = sessionById.get(identity(key)); if (childTab !== undefined) onCloseTab(childTab, child); }} onToggleIdentity={(sessionIdentity, expanded) => setExpandedDelegations((current) => { const next = new Set(current); if (expanded) next.add(sessionIdentity); else next.delete(sessionIdentity); return next; })} />}
              </div>;
            })}
          </div>}
        </section>;
      })}
      {workspace.tabs.length === 0 && <p className="workspace-tabs-empty">No open tabs</p>}
    </div>
    <button type="button" className="workspace-navigation-action" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}>
      {libraryOpen ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}<Library aria-hidden="true" size={15} />Previous Sessions
    </button>
    {libraryOpen && <div className="workspace-session-library" role="list" aria-label="Previous Sessions">
      {savedSessions.map((session) => { const project = projects.find(({ projectId }) => projectId === session.projectId); const location = project?.name ?? (session.displayPath === undefined ? "Directory unavailable" : directoryName(session.displayPath)); return <button type="button" role="listitem" aria-label={`Open ${label(session)}`} key={identity(session.sessionKey)} onClick={() => onOpenSession(session)}><SessionDot session={session} /><span>{label(session)}</span><small title={project === undefined ? session.displayPath : undefined}>{location}</small></button>; })}
      {savedSessions.length === 0 && <p>No previous Sessions to open.</p>}
    </div>}
  </nav>;
}

function directoryName(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, "");
  return normalized.split(/[\\/]/u).pop() || path;
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
  if (session.delegationStatus === "failed" || session.projection.synchronization === "failed") return ["Failed"];
  if (session.projection.run === "working" || session.delegationStatus === "working") return ["Working"];
  if (session.projection.unread.hasUnread) return ["Unread"];
  if (session.projection.availability === "closed") return ["Closed"];
  return [];
}
function SessionStatus({ session }: { session: SessionSummary }) { const values = statuses(session); return <small className="workspace-tab-status">{values.length === 0 ? "Idle" : values.join(" · ")}</small>; }
function SessionDot({ session }: { session: SessionSummary }) { const values = statuses(session); const status = values.includes("Failed") ? "failed" : values.includes("Working") ? "working" : values.includes("Unread") ? "unread" : "idle"; return <i className={`session-status-indicator status-${status}`} aria-label={`${values.length === 0 ? "Idle" : values.join(", ")} Session`} style={{ "--session-depth": 0 } as CSSProperties} />; }
