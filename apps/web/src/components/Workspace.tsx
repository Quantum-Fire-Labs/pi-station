import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { MessageStash, Workspace as WorkspaceDefinition, WorkspaceSessionTab } from "@pi-station/application-protocol";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioWaveform,
  Clock3,
  CornerDownRight,
  Ellipsis,
  Folder,
  Keyboard,
  Zap,
  LoaderCircle,
  Mic,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Settings,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  ApplicationCommand,
  ApplicationCommandResult,
  DevelopmentServerConfiguration,
  ProjectId,
  ProjectSummary,
  SessionKey,
  SessionSummary,
} from "../application/workspace-model";
import { sessionsVisibleInWorkspace } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { sessionKeysEqual } from "../application/application-client-base";
import type { ApplicationClient } from "../application/application-client";
import { AgentMentionMenu, agentMentionLabel, filterAgentMentions, type AgentMentionOption } from "./AgentMentionMenu";
import { filterSlashCommands, SlashCommandMenu, type SlashCommandOption } from "./SlashCommandMenu";
import { CommandPalette, type CommandPaletteInitialFlow } from "./CommandPalette";
import { useToast } from "./Toast";
import { ComposerControls } from "./ComposerControls";
import { FeedItem, isThinkingPlaceholder } from "./Timeline";
import type { SharedMarkdownFile } from "./SharedMarkdownEditor";
import { Modal } from "./Modal";
import { NewSessionPage } from "./NewSessionPage";
import { ProjectsPage } from "./ProjectsPage";
import { MobileNavigationMenu } from "./MobileNavigationMenu";
import { WorkspaceActionCancelled, WorkspaceRow } from "./WorkspaceRow";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { AgentAttention } from "./AgentAttention";
import { NotificationSettingsPage } from "./NotificationSettings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Sheet, SheetTrigger } from "./ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import type { SettingsRoute } from "./SettingsPage";

const ProjectPage = lazy(async () => ({
  default: (await import("./ProjectPage")).ProjectPage,
}));
const AddProjectPage = lazy(async () => ({
  default: (await import("./AddProjectPage")).AddProjectPage,
}));
const SessionDetails = lazy(async () => ({
  default: (await import("./SessionDetails")).SessionDetails,
}));
const SharedMarkdownEditor = lazy(async () => ({
  default: (await import("./SharedMarkdownEditor")).SharedMarkdownEditor,
}));
const SettingsPage = lazy(async () => ({
  default: (await import("./SettingsPage")).SettingsPage,
}));
const ThemeSettingsPage = lazy(async () => ({
  default: (await import("./ThemeSettingsPage")).ThemeSettingsPage,
}));
const VoiceSettingsPage = lazy(async () => ({
  default: (await import("./VoiceSettingsPage")).VoiceSettingsPage,
}));
const SessionDefaultsPage = lazy(async () => ({
  default: (await import("./SessionDefaultsPage")).SessionDefaultsPage,
}));
const TimezoneSettingsPage = lazy(async () => ({ default: (await import("./TimezoneSettingsPage")).TimezoneSettingsPage }));
const EditorSettingsPage = lazy(async () => ({ default: (await import("./EditorSettingsPage")).EditorSettingsPage }));
const ProviderAuthPage = lazy(async () => ({ default: (await import("./ProviderAuthPage")).ProviderAuthPage }));
const UpdateSettingsPage = lazy(async () => ({ default: (await import("./UpdateSettingsPage")).UpdateSettingsPage }));

interface WorkspaceProps {
  state: ApplicationState;
  client?: ApplicationClient | undefined;
  onSelect: (key: SessionKey) => void;
  requestedSessionKey?: SessionKey | undefined;
  onRequestedSessionOpened?: () => void;
  onCommand?: (
    action: ApplicationCommand["action"],
    targetSessionKey?: SessionKey,
  ) => string | undefined;
  onLoadEarlier?: () => boolean;
  onUploadImage?: (file: File, signal: AbortSignal) => Promise<string>;
  onDeleteImage?: (id: string) => Promise<void>;
  onUploadAttachment?: (file: File, signal: AbortSignal) => Promise<string>;
  onDeleteAttachment?: (id: string) => Promise<void>;
  onRestartManagedSession?: (sessionKey: SessionKey, expectedGenerationId: string) => string | undefined;
  onCreateManagedSession?: (
    workingDirectory: string,
    optionalName?: string,
    resumeSessionKey?: SessionKey,
  ) => string | undefined;
  onListDirectory?: (
    path?: string,
    showHidden?: boolean,
  ) => string | undefined;
  onCreateProject?: (name: string, directory: string) => string | undefined;
  onRemoveProject?: (projectId: ProjectId) => string | undefined;
  onSetProjectClosed?: (projectId: ProjectId, closed: boolean) => Promise<void>;
  onSetProjectBookmark?: (projectId: ProjectId, bookmarked: boolean) => string | undefined;
  onReorderProjectBookmark?: (
    projectId: ProjectId,
    direction: "up" | "down",
  ) => string | undefined;
  onSetSessionBookmark?: (
    projectId: ProjectId,
    sessionKey: SessionKey,
    bookmarked: boolean,
  ) => string | undefined;
  onReorderSessionBookmark?: (
    projectId: ProjectId,
    sessionKey: SessionKey,
    direction: "up" | "down",
  ) => string | undefined;
  onConfigureDevelopmentServer?: (projectId: ProjectId, configuration?: DevelopmentServerConfiguration) => string | undefined;
  onStartDevelopmentServer?: (projectId: ProjectId) => string | undefined;
  onStopDevelopmentServer?: (projectId: ProjectId) => string | undefined;
  onViewDevelopmentServerOutput?: (projectId: ProjectId) => string | undefined;
  onInitialPaint?: (timelineItems: number) => void;
  onOpenQuickSession?: () => void;
  embeddedSession?: boolean;
}

type DashboardView = "projects" | "running";

const dashboardViewStorageKey = "pi-station:dashboard:view";
const isDashboardView = (value: unknown): value is DashboardView => value === "projects" || value === "running";

const readDashboardView = (): DashboardView => {
  try {
    if (typeof window === "undefined") return "projects";
    const stored = window.sessionStorage.getItem(dashboardViewStorageKey);
    return isDashboardView(stored) ? stored : "projects";
  } catch {
    return "projects";
  }
};

const writeDashboardView = (view: DashboardView): void => {
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(dashboardViewStorageKey, view);
  } catch {
    // The Dashboard remains usable when browser storage is disabled.
  }
};

function Dashboard({
  state,
  onOpen,
  onOpenProject,
  onNewSession,
  onOpenQuickSession,
  onNewProjectSession,
  onAddProject,
  onDashboard,
  onProjects,
  onSettings,
}: {
  state: ApplicationState;
  onOpen: (key: SessionKey) => void;
  onOpenProject: (projectId: ProjectId) => void;
  onNewSession: () => void;
  onOpenQuickSession: () => void;
  onNewProjectSession: (project: ProjectSummary) => void;
  onAddProject: () => void;
  onDashboard: () => void;
  onProjects: () => void;
  onSettings: () => void;
}) {
  const [view, setView] = useState<DashboardView>(readDashboardView);
  const [showingClosed, setShowingClosed] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const bookmarkPosition = new Map(
    state.projectBookmarks.map(({ projectId, position }) => [
      projectId,
      position,
    ]),
  );
  const closedProjectIds = new Set(
    state.projects
      .filter((project) => project.closed === true)
      .map((project) => project.projectId),
  );
  const liveSessions = state.sessions
    .filter((session) => (
      sessionIsOpen(session)
      && (session.projectId === undefined || !closedProjectIds.has(session.projectId))
    ))
    .sort((left, right) => sessionTime(right.lastActivityAt)
      - sessionTime(left.lastActivityAt));
  const openSessionGroups = dashboardSessionGroups(liveSessions);
  const activeProjectIds = new Set(
    liveSessions.flatMap((session) =>
      session.projectId === undefined ? [] : [session.projectId],
    ),
  );
  const projects = state.projects
    .filter((project) => project.closed !== true)
    .filter((project) => (
      bookmarkPosition.has(project.projectId)
      || activeProjectIds.has(project.projectId)
    ))
    .sort((left, right) => {
      const leftPosition = bookmarkPosition.get(left.projectId);
      const rightPosition = bookmarkPosition.get(right.projectId);
      if (leftPosition !== undefined || rightPosition !== undefined) {
        return (leftPosition ?? Number.MAX_SAFE_INTEGER)
          - (rightPosition ?? Number.MAX_SAFE_INTEGER);
      }
      return projectActivity(right.projectId, liveSessions)
        - projectActivity(left.projectId, liveSessions);
    });

  const toggleClosed = (projectId: string): void => {
    setShowingClosed((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <main className="dashboard">
      <div className="dashboard-shell">
        <header className="dashboard-header">
          <MobileNavigationMenu
            current="dashboard"
            onNewSession={onNewSession}
            onNewProject={onAddProject}
            onDashboard={onDashboard}
            onProjects={onProjects}
            onSettings={onSettings}
          />
          <div className="dashboard-heading">
            <h1>Dashboard</h1>
            <p>Open a Project or continue a recent Session.</p>
          </div>
          <div className="dashboard-header-actions">
            <Button type="button" variant="outline" onClick={onAddProject}>
              <Folder data-icon="inline-start" aria-hidden="true" size={16} />
              Add Project
            </Button>
            <Button type="button" onClick={onNewSession}>
              <Plus data-icon="inline-start" aria-hidden="true" size={16} />
              New Session
            </Button>
          </div>
          <div className="dashboard-mobile-actions">
            <Button type="button" size="icon" aria-label="Quick Session" title="Quick Session" onClick={onOpenQuickSession}>
              <Zap aria-hidden="true" />
            </Button>
            <Button
              className="dashboard-mobile-new-session"
              type="button"
              size="icon"
              aria-label="New Session"
              title="New Session"
              onClick={onNewSession}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </header>

        <Tabs value={view} onValueChange={(value) => {
          if (!isDashboardView(value)) return;
          setView(value);
          writeDashboardView(value);
        }}>
          <TabsList aria-label="Dashboard view">
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="running" aria-label="Open">
              Open
              {liveSessions.length > 0 && <span className="dashboard-count">{liveSessions.length}</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="projects">
            <div className="dashboard-projects" role="list">
              {projects.length === 0 && (
                <div className="dashboard-empty">
                  <Folder aria-hidden="true" size={22} />
                  <strong>No Projects yet.</strong>
                  <p>Add a Project to give Pi a working directory.</p>
                  <Button type="button" onClick={onAddProject}>Add Project</Button>
                </div>
              )}
              {projects.map((project) => {
                const sessions = state.sessions.filter(
                  (session) => session.projectId === project.projectId,
                );
                const running = sessions.filter(sessionIsOpen);
                const closed = sessions.filter((session) => !sessionIsOpen(session));
                const revealClosed = showingClosed.has(project.projectId);
                return (
                  <Card
                    className={`dashboard-project gap-0 bg-transparent py-0${project.available ? "" : " unavailable"}`}
                    key={project.projectId}
                    role="listitem"
                  >
                    <CardHeader className="dashboard-project-header">
                      <button
                        className="dashboard-project-open"
                        type="button"
                        onClick={() => onOpenProject(project.projectId)}
                      >
                        <span className="dashboard-project-icon">
                          <Folder aria-hidden="true" size={18} />
                        </span>
                        <span>
                          <h2>{project.name}</h2>
                          <small>{running.length} open {running.length === 1 ? "Session" : "Sessions"}</small>
                        </span>
                      </button>
                      <span className="dashboard-project-actions">
                        {closed.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-pressed={revealClosed}
                            aria-label={`${revealClosed ? "Hide" : "Show"} ${closed.length} closed bookmarked ${closed.length === 1 ? "Session" : "Sessions"} in ${project.name}`}
                            onClick={() => toggleClosed(project.projectId)}
                          >
                            <Clock3 aria-hidden="true" size={16} />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={!project.available}
                          aria-label={`New Session in ${project.name}`}
                          onClick={() => onNewProjectSession(project)}
                        >
                          <Plus aria-hidden="true" size={17} />
                        </Button>
                      </span>
                    </CardHeader>
                    <CardContent className="dashboard-project-sessions">
                      {running.length === 0 && !revealClosed && (
                        <p>{project.available ? "No open Sessions" : "Directory unavailable"}</p>
                      )}
                      {dashboardNestedSessions(revealClosed ? sessions : running)
                        .map(({ session, depth }) => (
                          <DashboardSession
                            key={sessionIdentity(session.sessionKey)}
                            session={session}
                            depth={depth}
                            context={undefined}
                            onOpen={onOpen}
                          />
                        ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="running">
            {liveSessions.length === 0 ? (
              <div className="dashboard-empty">
                <Play aria-hidden="true" size={22} />
                <strong>No Pi Sessions are open.</strong>
                <p>Start a Session when you are ready to continue.</p>
                <Button type="button" onClick={onNewSession}>New Session</Button>
              </div>
            ) : (
              <div className="dashboard-open-groups">
                {openSessionGroups.map((group) => (
                  <section key={group.label} className="dashboard-open-group">
                    <h2>{group.label}</h2>
                    <Card className="dashboard-running gap-0 bg-transparent py-1">
                      {group.sessions.map(({ session, depth }) => (
                        <DashboardSession
                          key={sessionIdentity(session.sessionKey)}
                          session={session}
                          depth={depth}
                          context={depth === 0
                            ? dashboardSessionContext(session, state.projects)
                            : undefined}
                          onOpen={onOpen}
                        />
                      ))}
                    </Card>
                  </section>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function DashboardSession({
  session,
  depth,
  context,
  onOpen,
}: {
  session: SessionSummary;
  depth: number;
  context: string | undefined;
  onOpen: (key: SessionKey) => void;
}) {
  const available = session.projection.availability === "available";
  const reconnecting = session.projection.availability === "reconnecting";
  return (
    <button
      className={`dashboard-session-row${reconnecting ? " reconnecting" : ""}`}
      type="button"
      data-session-depth={depth}
      style={{ "--session-depth": depth } as CSSProperties}
      disabled={!available && !reconnecting}
      title={reconnecting ? "Session is reconnecting" : available ? "" : "Session resume is not available yet"}
      onClick={() => onOpen(session.sessionKey)}
    >
      <span>
        {depth > 0 && <CornerDownRight className="dashboard-session-nesting" aria-hidden="true" size={13} />}
        <i className={session.projection.run === "working" ? "working" : ""} />
        <span className="dashboard-session-copy">
          <span className="dashboard-session-name">{sessionLabel(session)}</span>
          {context !== undefined && <small>{context}</small>}
        </span>
      </span>
      {(reconnecting || !available) && (
        <span className="dashboard-session-state">
          <Badge variant="outline">{reconnecting ? "Reconnecting" : "Closed"}</Badge>
        </span>
      )}
    </button>
  );
}

function dashboardSessionContext(
  session: SessionSummary,
  projects: readonly ProjectSummary[],
): string | undefined {
  if (session.projectId === undefined) return session.displayPath;
  return projects.find((project) => project.projectId === session.projectId)?.name
    ?? session.displayPath;
}

type DashboardNestedSession = { session: SessionSummary; depth: number };
type DashboardSessionGroup = {
  label: "Today" | "Yesterday" | "Earlier";
  sessions: DashboardNestedSession[];
};

function dashboardSessionGroups(
  sessions: readonly SessionSummary[],
  now = new Date(),
): readonly DashboardSessionGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const groups = new Map<DashboardSessionGroup["label"], DashboardNestedSession[]>();
  let parentGroup: DashboardSessionGroup["label"] = "Earlier";

  for (const nestedSession of dashboardNestedSessions(sessions)) {
    if (nestedSession.depth === 0) {
      const activity = sessionTime(nestedSession.session.lastActivityAt);
      parentGroup = activity >= today ? "Today" : activity >= yesterday ? "Yesterday" : "Earlier";
    }
    groups.set(parentGroup, [...(groups.get(parentGroup) ?? []), nestedSession]);
  }

  return (["Today", "Yesterday", "Earlier"] as const).flatMap((label) => {
    const groupedSessions = groups.get(label);
    return groupedSessions === undefined ? [] : [{ label, sessions: groupedSessions }];
  });
}

function dashboardNestedSessions(
  sessions: readonly SessionSummary[],
): readonly DashboardNestedSession[] {
  const sessionsByIdentity = new Map(sessions.map((session) => [
    sessionIdentity(session.sessionKey),
    session,
  ]));
  const children = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const parentIdentity = session.parentSessionKey === undefined
      ? undefined
      : sessionIdentity(session.parentSessionKey);
    if (parentIdentity === undefined || !sessionsByIdentity.has(parentIdentity)) continue;
    children.set(parentIdentity, [...(children.get(parentIdentity) ?? []), session]);
  }
  const result: { session: SessionSummary; depth: number }[] = [];
  const visited = new Set<string>();
  const append = (session: SessionSummary, depth: number): void => {
    const identity = sessionIdentity(session.sessionKey);
    if (visited.has(identity)) return;
    visited.add(identity);
    result.push({ session, depth });
    for (const child of children.get(identity) ?? []) append(child, depth + 1);
  };
  for (const session of sessions) {
    const parentIdentity = session.parentSessionKey === undefined
      ? undefined
      : sessionIdentity(session.parentSessionKey);
    if (parentIdentity === undefined || !sessionsByIdentity.has(parentIdentity)) append(session, 0);
  }
  for (const session of sessions) append(session, 0);
  return result;
}

const sessionIsOpen = (session: SessionSummary): boolean => (
  session.projection.availability === "available"
  || session.projection.availability === "reconnecting"
);

function projectActivity(
  projectId: string,
  sessions: readonly SessionSummary[],
): number {
  return Math.max(
    ...sessions
      .filter((session) => session.projectId === projectId)
      .map((session) => sessionTime(session.lastActivityAt)),
    0,
  );
}

const commandOutcomeError = (
  outcome: ApplicationCommandResult["outcome"] | undefined,
): string | undefined => {
  if (outcome === undefined || outcome.status === "succeeded") return undefined;
  if (outcome.status === "outcome-unknown") {
    return "Pi may have closed, but Pi Station could not confirm the result.";
  }
  if (outcome.status === "stale-generation") {
    return "This Session changed before Pi Station could close it.";
  }
  return outcome.error.message;
};

const sessionLabel = (session: SessionSummary): string => {
  if (session.name) return session.name;
  const offline = session.projection.availability === "closed"
    || session.projection.availability === "unavailable";
  if (offline) {
    return "Untitled conversation";
  }
  return session.displayPath?.split("/").filter(Boolean).pop() ?? "Pi session";
};

const sessionIdentity = (sessionKey: SessionKey): string => sessionKey.piSessionId;

const isDesktopViewport = (): boolean => window.matchMedia?.("(min-width: 1100px)").matches
  ?? window.innerWidth >= 1100;

const sessionTime = (value?: string): number => {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sessionEditorFilesKey = "pi-station:session-editor-files";
const workspaceMruKey = "pi-station:workspace-mru";

export function activityWorkspaceTarget(workspaces: readonly WorkspaceDefinition[], currentWorkspaceId: string | undefined, sessionKey: SessionKey, mru: readonly string[]): { workspace: WorkspaceDefinition; tab: WorkspaceSessionTab } | undefined {
  const matches = workspaces
    .filter((workspace) => workspace.closedAt === undefined)
    .flatMap((workspace) => workspace.tabs
      .filter((tab) => tab.projectId === sessionKey.hostId && tab.sessionId === sessionKey.piSessionId)
      .map((tab) => ({ workspace, tab })));
  const current = matches.find(({ workspace }) => workspace.id === currentWorkspaceId);
  if (current !== undefined) return current;
  const mruPosition = new Map(mru.map((id, index) => [id, index]));
  return matches.sort((left, right) => (mruPosition.get(left.workspace.id) ?? Number.MAX_SAFE_INTEGER) - (mruPosition.get(right.workspace.id) ?? Number.MAX_SAFE_INTEGER))[0];
}

function readWorkspaceMru(): readonly string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(workspaceMruKey) ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
}

function writeWorkspaceMru(ids: readonly string[]): void {
  try { localStorage.setItem(workspaceMruKey, JSON.stringify(ids)); } catch { /* Browser-local navigation state is optional. */ }
}
const composerDraftKey = (identity: string): string => `pi-station:composer-draft:${identity}`;

const readComposerDraft = (identity?: string): string => {
  if (identity === undefined) return "";
  try { return localStorage.getItem(composerDraftKey(identity)) ?? ""; }
  catch { return ""; }
};

const writeComposerDraft = (identity: string | undefined, draft: string): void => {
  if (identity === undefined) return;
  try {
    if (draft.length === 0) localStorage.removeItem(composerDraftKey(identity));
    else localStorage.setItem(composerDraftKey(identity), draft);
  } catch { /* Restricted storage keeps the draft in memory for this visit. */ }
};

const readSessionEditorFiles = (): Readonly<Record<string, SharedMarkdownFile>> => {
  try {
    const value = JSON.parse(localStorage.getItem(sessionEditorFilesKey) ?? "{}") as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, SharedMarkdownFile] => {
      const file = entry[1];
      return typeof file === "object" && file !== null
        && "name" in file && typeof file.name === "string"
        && "url" in file && typeof file.url === "string";
    }));
  } catch { return {}; }
};

const writeSessionEditorFiles = (files: Readonly<Record<string, SharedMarkdownFile>>): void => {
  try { localStorage.setItem(sessionEditorFilesKey, JSON.stringify(files)); } catch { /* Restricted storage keeps state in memory. */ }
};

function Sidebar({
  state,
  onDashboard,
  onQuickSession,
  onGeneralNewSession,
  onNewSession,
  onProjects,
  onSettings,
  activeRoute,
  shortcutsVisible,
  onCollapse,
  onCloseWorkspaceTab,
  onCloseProjectTabs,
  onAddDirectoryAsProject,
  onOpenSessionInWorkspace,
  onActivitySelect,
  onSelectWorkspaceTab,
}: {
  state: ApplicationState;
  onDashboard: () => void;
  onQuickSession?: (() => void) | undefined;
  onNewSession: (project: ProjectSummary) => void;
  onGeneralNewSession: () => void;
  onProjects: () => void;
  onSettings: () => void;
  onOpenProject: (projectId: ProjectId) => void;
  onSessionContextMenu: (session: SessionSummary, x: number, y: number) => void;
  activeRoute: "workspace" | "dashboard" | "new-session" | "new-directory-session" | "projects" | "project" | "add-project" | "settings" | "notifications" | "themes" | "voice-messages" | "session-defaults" | "timezone" | "editor" | "providers" | "update";
  activeProjectId?: ProjectId;
  shortcutsVisible: boolean;
  onCollapse: () => void;
  onCloseWorkspaceTab: (tab: WorkspaceSessionTab, session?: SessionSummary) => void;
  onCloseProjectTabs: (project: ProjectSummary) => void;
  onAddDirectoryAsProject: (directory: string) => void;
  onOpenSessionInWorkspace: (session: SessionSummary) => void;
  onActivitySelect: (session: SessionSummary) => void;
  onSelectWorkspaceTab: (tab: WorkspaceSessionTab, session: SessionSummary) => void;
}) {
  const activeWorkspace = (state.workspaces ?? []).find(({ id }) => id === state.activeWorkspaceId);
  return (
    <aside className={`sidebar${shortcutsVisible ? " shortcuts-visible" : ""}`} aria-label="Workspace and Sessions">
      <header className="sidebar-header">
        <button type="button" className={`sidebar-home${activeRoute === "dashboard" ? " selected" : ""}`} aria-label="Dashboard" aria-current={activeRoute === "dashboard" ? "page" : undefined} onClick={onDashboard}>
          <svg className="sidebar-brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12 12 5M5 12h14M19 12l-7 7" /><circle cx="5" cy="12" r="2.5" /><circle cx="12" cy="5" r="2.5" /><circle cx="19" cy="12" r="2.5" /><circle cx="12" cy="19" r="2.5" /></svg>
          Pi Station
        </button>
        <div className="sidebar-header-actions">
        {onQuickSession !== undefined && <button type="button" className="sidebar-quick-session" aria-label="Quick Session" title="Quick Session (Ctrl/⌘+Shift+Space)" aria-keyshortcuts="Control+Shift+Space Meta+Shift+Space" onClick={onQuickSession}><Zap aria-hidden="true" size={16} /></button>}
        <button type="button" aria-label="New Session" title="New Session" onClick={onGeneralNewSession}><Plus aria-hidden="true" size={16} /></button>
        <button type="button" aria-label="Hide sidebar" aria-keyshortcuts="Control+B Meta+B" onClick={onCollapse}><PanelLeftClose aria-hidden="true" size={17} /></button>
        </div>
      </header>
      <div className="workspace-sidebar-navigation">
        <AgentAttention sessions={state.sessions} projects={state.projects} selectedSessionKey={state.selectedSessionKey} onSelect={(key) => {
          const session = state.sessions.find((candidate) => sessionKeysEqual(candidate.sessionKey, key));
          if (session !== undefined) onActivitySelect(session);
        }} />
        {activeWorkspace && <WorkspaceNavigation
          workspace={activeWorkspace}
          projects={state.projects}
          sessions={sessionsVisibleInWorkspace(state.sessions)}
          selectedSessionKey={state.selectedSessionKey}
          onNewSession={onGeneralNewSession}
          onNewSessionInProject={onNewSession}
          onOpenSession={onOpenSessionInWorkspace}
          onSelectTab={onSelectWorkspaceTab}
          onCloseTab={onCloseWorkspaceTab}
          onCloseProjectTabs={onCloseProjectTabs}
          onAddDirectoryAsProject={onAddDirectoryAsProject}
        />}
      </div>
      <footer>
        <button className={activeRoute === "projects" || activeRoute === "add-project" ? "selected" : undefined} aria-label="Projects" aria-current={activeRoute === "projects" || activeRoute === "add-project" ? "page" : undefined} onClick={onProjects}><Folder aria-hidden="true" size={17} /><span>Projects</span></button>
        <button className={["settings", "notifications", "themes"].includes(activeRoute) ? "selected" : undefined} aria-label="Settings" aria-current={["settings", "notifications", "themes"].includes(activeRoute) ? "page" : undefined} onClick={onSettings}><Settings aria-hidden="true" size={17} /><span>Settings</span></button>
      </footer>
    </aside>
  );
}

function SessionContextMenu({
  session,
  x,
  y,
  bookmarked,
  onClose,
  onRename,
  onBookmark,
  onClone,
  onReload,
  onRequestClose,
}: {
  session: SessionSummary;
  x: number;
  y: number;
  bookmarked: boolean;
  onClose: () => void;
  onRename: () => void;
  onBookmark: () => void;
  onClone: () => void;
  onReload: () => void;
  onRequestClose: () => void;
}) {
  const menu = useRef<HTMLDivElement | null>(null);
  const capabilities: readonly string[] = session.projection.capabilities;
  const synchronized = session.projection.synchronization === "synchronized";
  const idle = session.projection.run === "idle";
  const available = session.projection.availability === "available";

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const dismissWithEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithEscape);
    menu.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [onClose]);

  const action = (callback: () => void): void => {
    onClose();
    callback();
  };
  return (
    <div
      ref={menu}
      className="session-context-menu"
      role="menu"
      aria-label={`Actions for ${sessionLabel(session)}`}
      tabIndex={-1}
      style={{ left: x, top: y }}
    >
      <button role="menuitem" disabled={!available || !synchronized || !capabilities.includes("session.rename")} onClick={() => action(onRename)}>Rename</button>
      <button role="menuitem" disabled={session.projectId === undefined} onClick={() => action(onBookmark)}>{bookmarked ? "Remove Bookmark" : "Bookmark"}</button>
      <button role="menuitem" disabled={!available || !synchronized || !idle || !capabilities.includes("session.clone")} onClick={() => action(onClone)}>Clone Session</button>
      <button role="menuitem" disabled={!available || !synchronized || !idle || !capabilities.includes("session.reload")} onClick={() => action(onReload)}>Reload Pi Session</button>
      <hr />
      <button className="danger" role="menuitem" disabled={!available || !synchronized || !capabilities.includes("session.close")} onClick={() => action(onRequestClose)}>Close</button>
    </div>
  );
}

function InitialConnectionScreen({ state }: { state: ApplicationState }) {
  const label = state.connection === "reconnecting"
    ? "Reconnecting to Pi Station…"
    : state.connection === "synchronizing"
      ? "Synchronizing Workspace…"
      : "Connecting to Pi Station…";
  return (
    <main className="initial-connection-screen">
      <div className="initial-connection-content" role="status" aria-live="polite">
        <span className="initial-connection-mark" aria-hidden="true" />
        <h1>Pi Station</h1>
        <p>{label}</p>
      </div>
    </main>
  );
}

function ConnectionNotice({ state }: { state: ApplicationState }) {
  if (state.connection === "ready") return null;
  const label = state.connection === "reconnecting"
    ? "Connection lost. Reconnecting…"
    : state.connection === "synchronizing"
      ? "Synchronizing Workspace…"
      : "Connecting to Pi Station…";
  return (
    <div className="connection-notice" role="status">
      {label}
    </div>
  );
}

export function Workspace({
  state: applicationState,
  client,
  onSelect,
  requestedSessionKey,
  onRequestedSessionOpened,
  onCommand,
  onLoadEarlier,
  onUploadImage,
  onDeleteImage,
  onUploadAttachment,
  onDeleteAttachment,
  onRestartManagedSession,
  onCreateManagedSession,
  onListDirectory,
  onCreateProject,
  onRemoveProject,
  onSetProjectClosed,
  onSetProjectBookmark,
  onReorderProjectBookmark,
  onSetSessionBookmark,
  onReorderSessionBookmark,
  onConfigureDevelopmentServer,
  onStartDevelopmentServer,
  onStopDevelopmentServer,
  onViewDevelopmentServerOutput,
  onInitialPaint,
  onOpenQuickSession,
  embeddedSession = false,
}: WorkspaceProps) {
  const activeWorkspace = applicationState.workspaces?.find(({ id }) => id === applicationState.activeWorkspaceId)
    ?? applicationState.workspaces?.find((workspace) => workspace.closedAt === undefined);
  const workspaceMru = useRef<readonly string[]>(readWorkspaceMru());
  useEffect(() => {
    const id = applicationState.activeWorkspaceId;
    const workspace = applicationState.workspaces?.find((candidate) => candidate.id === id);
    if (id === undefined || workspace === undefined || workspace.closedAt !== undefined) return;
    workspaceMru.current = [id, ...workspaceMru.current.filter((candidate) => candidate !== id)];
    writeWorkspaceMru(workspaceMru.current);
  }, [applicationState.activeWorkspaceId, applicationState.workspaces]);
  // Projects and saved Sessions are global library data. Explicit tabs control Workspace navigation.
  const state = embeddedSession ? applicationState : {
    ...applicationState,
    sessions: sessionsVisibleInWorkspace(applicationState.sessions),
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInitialFlow, setPaletteInitialFlow] = useState<CommandPaletteInitialFlow>("actions");
  const [addProjectInitialDirectory, setAddProjectInitialDirectory] = useState<string>();
  const { toast } = useToast();
  const [sessionShortcutsVisible, setSessionShortcutsVisible] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(408);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;
  useEffect(() => {
    const toggleSidebar = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "b" || event.altKey || event.shiftKey || event.isComposing) return;
      const expectedModifier = /Mac|iPhone|iPad/u.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!expectedModifier || !isDesktopViewport()) return;
      event.preventDefault();
      setSidebarVisible((visible) => !visible);
    };
    window.addEventListener("keydown", toggleSidebar);
    return () => window.removeEventListener("keydown", toggleSidebar);
  }, []);
  useEffect(() => {
    const openQuickSession = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || !event.shiftKey || event.altKey || event.isComposing || event.repeat) return;
      const expectedModifier = /Mac|iPhone|iPad/u.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!expectedModifier || onOpenQuickSession === undefined) return;
      event.preventDefault();
      onOpenQuickSession();
    };
    window.addEventListener("keydown", openQuickSession);
    return () => window.removeEventListener("keydown", openQuickSession);
  }, [onOpenQuickSession]);
  useEffect(() => {
    if (!resizingSidebar) return;
    const resize = (event: PointerEvent): void => setSidebarWidth(Math.min(500, Math.max(280, event.clientX)));
    const stop = (): void => setResizingSidebar(false);
    document.body.classList.add("sidebar-resizing");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      document.body.classList.remove("sidebar-resizing");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizingSidebar]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileWorkspaceNavigationRef = useRef<HTMLDetailsElement>(null);
  const editorIdentity = state.selectedSessionKey === undefined
    ? undefined
    : sessionIdentity(state.selectedSessionKey);
  const [sessionEditorFiles, setSessionEditorFiles] = useState(readSessionEditorFiles);
  const [dirtySessionEditors, setDirtySessionEditors] = useState<ReadonlySet<string>>(new Set());
  const sharedMarkdownFile = editorIdentity === undefined ? undefined : sessionEditorFiles[editorIdentity];
  const sharedMarkdownDirty = editorIdentity !== undefined && dirtySessionEditors.has(editorIdentity);
  const updateSessionEditorFiles = (update: (current: Readonly<Record<string, SharedMarkdownFile>>) => Record<string, SharedMarkdownFile>): void => {
    setSessionEditorFiles((current) => {
      const next = update(current);
      writeSessionEditorFiles(next);
      return next;
    });
  };
  const discardCurrentEditorDraft = (): void => {
    if (editorIdentity === undefined) return;
    try { localStorage.removeItem(`pi-station:shared-markdown-draft:${editorIdentity}`); } catch { /* Restricted storage has no persisted draft. */ }
  };
  const setCurrentEditorDirty = (dirty: boolean): void => {
    if (editorIdentity === undefined) return;
    setDirtySessionEditors((current) => {
      const next = new Set(current);
      if (dirty) next.add(editorIdentity); else next.delete(editorIdentity);
      return next;
    });
  };
  const [discardSharedMarkdownAction, setDiscardSharedMarkdownAction] = useState<(() => void)>();
  const discardSharedMarkdownCancel = useRef<(() => void) | undefined>(undefined);
  const cancelNavigation = (): void => {
    setDiscardSharedMarkdownAction(undefined);
    discardSharedMarkdownCancel.current?.();
    discardSharedMarkdownCancel.current = undefined;
  };
  const [closeSessionConfirmOpen, setCloseSessionConfirmOpen] = useState(false);
  const [commandApprovalPending, setCommandApprovalPending] = useState(false);
  const [commandApprovalError, setCommandApprovalError] = useState<string>();
  const [closeSessionRequestId, setCloseSessionRequestId] = useState<string>();
  const [reloadSessionRequestId, setReloadSessionRequestId] = useState<string>();
  const [restartSessionRequestId, setRestartSessionRequestId] = useState<string>();
  const [restartSessionTarget, setRestartSessionTarget] = useState<{
    sessionKey: SessionKey
    generationId: string
  }>();
  const [restartSessionLaunchError, setRestartSessionLaunchError] = useState<string>();
  const [cloneSessionRequestId, setCloneSessionRequestId] = useState<string>();
  const [sessionSettingRequestId, setSessionSettingRequestId] = useState<string>();
  const [detailsBookmarkRequestId, setDetailsBookmarkRequestId] = useState<string>();
  const [sessionContextMenu, setSessionContextMenu] = useState<{
    session: SessionSummary
    x: number
    y: number
  }>();
  const [renameSession, setRenameSession] = useState<SessionSummary>();
  const [renameSessionName, setRenameSessionName] = useState("");
  const [closeSessionTarget, setCloseSessionTarget] = useState<SessionSummary>();
  const [developmentServerRequestId, setDevelopmentServerRequestId] = useState<string>();
  const [newSessionProject, setNewSessionProject] = useState<ProjectSummary>();
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionRequestId, setNewSessionRequestId] = useState<string>();
  const [resumeSessionRequestId, setResumeSessionRequestId] = useState<string>();
  type Route = "workspace" | "dashboard" | "new-session" | "new-directory-session" | "projects" | "project"
    | "add-project" | "settings" | SettingsRoute;
  const [route, setRouteState] = useState<Route>("workspace");
  useEffect(() => {
    if (embeddedSession && state.selectedSessionKey !== undefined) setRouteState("workspace");
  }, [embeddedSession, state.selectedSessionKey]);
  useEffect(() => {
    mobileWorkspaceNavigationRef.current?.removeAttribute("open");
  }, [state.activeWorkspaceId, state.selectedSessionKey?.hostId, state.selectedSessionKey?.piSessionId, route]);
  useEffect(() => {
    const closeMobileNavigationOutside = (event: PointerEvent): void => {
      const navigation = mobileWorkspaceNavigationRef.current;
      if (navigation?.hasAttribute("open") === true && !navigation.contains(event.target as Node)) navigation.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeMobileNavigationOutside);
    return () => document.removeEventListener("pointerdown", closeMobileNavigationOutside);
  }, []);
  const afterSharedMarkdownCheck = (action: () => void, onCancel?: () => void): void => {
    if (sharedMarkdownDirty || images.length > 0 || files.length > 0) {
      discardSharedMarkdownCancel.current?.();
      discardSharedMarkdownCancel.current = onCancel;
      setDiscardSharedMarkdownAction(() => action);
    } else action();
  };
  const navigationCheck = useRef(afterSharedMarkdownCheck);
  navigationCheck.current = afterSharedMarkdownCheck;
  const setRoute = (next: Route): void => afterSharedMarkdownCheck(() => setRouteState(next));
  const guardedWorkspaceAction = (action: () => Promise<void>): Promise<void> => new Promise<void>((resolve, reject) => {
    afterSharedMarkdownCheck(() => { void Promise.resolve().then(action).then(resolve, reject); }, () => reject(new WorkspaceActionCancelled()));
  });
  const activateWorkspace = async (id: string): Promise<void> => {
    if (client === undefined) return;
    const targetWorkspace = applicationState.workspaces?.find((workspace) => workspace.id === id);
    const activeTab = targetWorkspace?.tabs?.find((tab) => tab.id === targetWorkspace.activeTabId) ?? targetWorkspace?.tabs?.[0];
    const targetSession = activeTab === undefined ? undefined : applicationState.sessions.find((session) => session.sessionKey.hostId === activeTab.projectId && session.sessionKey.piSessionId === activeTab.sessionId);
    await client.activateWorkspace(id);
    setDetailsOpen(false);
    setSelectedProjectId(undefined);
    if (targetSession === undefined) setRouteState("workspace");
    else {
      onSelect(targetSession.sessionKey);
      setRouteState("workspace");
    }
  };
  const openSharedMarkdown = (file: SharedMarkdownFile): void => {
    if (editorIdentity === undefined || sharedMarkdownFile?.url === file.url) return;
    afterSharedMarkdownCheck(() => {
      updateSessionEditorFiles((current) => ({ ...current, [editorIdentity]: file }));
      setCurrentEditorDirty(false);
      setDetailsOpen(false);
    });
  };
  const closeSharedMarkdown = (): void => afterSharedMarkdownCheck(() => {
    if (editorIdentity === undefined) return;
    updateSessionEditorFiles((current) => {
      const next = { ...current };
      delete next[editorIdentity];
      return next;
    });
    setCurrentEditorDirty(false);
  });
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId>();
  useEffect(() => {
    const cycleWorkspace = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || (event.key !== "[" && event.key !== "]")) return;
      if (document.querySelector("dialog[open], [role='dialog']") !== null) return;
      const workspaces = (state.workspaces ?? []).filter(({ closedAt }) => closedAt === undefined);
      if (client === undefined || workspaces.length < 2) return;
      const current = Math.max(0, workspaces.findIndex(({ id }) => id === state.activeWorkspaceId));
      const offset = event.key === "]" ? 1 : -1;
      const target = workspaces[(current + offset + workspaces.length) % workspaces.length];
      if (target === undefined) return;
      event.preventDefault();
      navigationCheck.current(() => {
        void activateWorkspace(target.id).catch((reason: unknown) => toast({
          message: reason instanceof Error ? reason.message : "Workspace could not be opened. Try again.",
          variant: "error",
        }));
      });
    };
    window.addEventListener("keydown", cycleWorkspace);
    return () => window.removeEventListener("keydown", cycleWorkspace);
  }, [applicationState.sessions, client, onSelect, state.activeWorkspaceId, state.workspaces, sharedMarkdownDirty, toast]);
  const selectedSessionIdentity = state.selectedSessionKey === undefined
    ? undefined
    : sessionIdentity(state.selectedSessionKey);
  const selectedSessionIdentityRef = useRef(selectedSessionIdentity);
  selectedSessionIdentityRef.current = selectedSessionIdentity;
  const [draft, setDraft] = useState(() => readComposerDraft(selectedSessionIdentity));
  const [agentMention, setAgentMention] = useState<{ readonly start: number; readonly query: string }>();
  const [agentMentionIndex, setAgentMentionIndex] = useState(0);
  const [slashCommandQuery, setSlashCommandQuery] = useState<string>();
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [selectedAgentMentions, setSelectedAgentMentions] = useState<readonly { readonly sessionId: string; readonly label: string; readonly token: string }[]>([]);
  const [images, setImages] = useState<readonly {
    readonly localId: string
    readonly name: string
    readonly previewUrl: string
    readonly controller: AbortController
    readonly status: "uploading" | "ready" | "error"
    readonly uploadId?: string
    readonly error?: string
  }[]>([]);
  const [files, setFiles] = useState<readonly { localId: string; name: string; size: number; controller: AbortController; status: "uploading" | "ready" | "error"; uploadId?: string; error?: string }[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [promptError, setPromptError] = useState<string>();
  const [stashes, setStashes] = useState<readonly MessageStash[]>([]);
  const [stashPending, setStashPending] = useState(false);
  const [voiceConfiguration, setVoiceConfiguration] = useState<{ configured: boolean; maximumSeconds: number; playbackSpeed: number; speechModel: string; speechVoice: string }>({ configured: false, maximumSeconds: 60, playbackSpeed: 1, speechModel: "", speechVoice: "" });
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing" | "playing">("idle");
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem("pi-station:composer-mode") === "voice");
  const [voiceAutoplay, setVoiceAutoplay] = useState(true);
  const voiceAudio = useRef<HTMLAudioElement | undefined>(undefined);
  const voiceAudioUrl = useRef<string | undefined>(undefined);
  const speechOperation = useRef(0);
  const speechCache = useRef(new Map<string, Blob>());
  const [playingResponseId, setPlayingResponseId] = useState<string>();
  const voiceResponseBaseline = useRef<string | undefined>(undefined);
  const awaitingVoiceResponse = useRef(false);
  const voiceResponsesToSkip = useRef(0);
  const [voiceError, setVoiceError] = useState<string>();
  const voiceRecorder = useRef<MediaRecorder | undefined>(undefined);
  const voiceStream = useRef<MediaStream | undefined>(undefined);
  const voiceChunks = useRef<Blob[]>([]);
  const voiceSelection = useRef({ start: 0, end: 0, identity: selectedSessionIdentity, direct: false });
  const voiceLimitTimer = useRef<number | undefined>(undefined);
  const voiceKeepRecording = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [submittedRequestId, setSubmittedRequestId] = useState<string>();
  const submittedSessionIdentity = useRef<string | undefined>(undefined);
  const [optimisticPrompt, setOptimisticPrompt] = useState<{
    readonly requestId: string
    readonly text: string
    readonly baselineMatches: number
  }>();
  const [pendingAgentActivity, setPendingAgentActivity] = useState<{
    readonly baselineTimelineItems: number
  }>();
  const [mobileTimeline, setMobileTimeline] = useState(() => (
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 1099px)").matches
  ));
  const [visibleTimelineItems, setVisibleTimelineItems] = useState(
    mobileTimeline ? 120 : 300,
  );
  const previousTimelineLength = useRef(state.selected.timeline.length);
  const initialPaintReported = useRef(false);
  const composerInput = useRef<HTMLTextAreaElement | null>(null);
  const composerShell = useRef<HTMLElement | null>(null);
  const sessionContainer = useRef<HTMLElement | null>(null);
  const newSessionNameInput = useRef<HTMLInputElement | null>(null);
  const renameSessionNameInput = useRef<HTMLInputElement | null>(null);
  const focusComposerForSession = useRef<SessionKey | undefined>(undefined);
  const followsLatest = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  useEffect(() => {
    setDraft(readComposerDraft(selectedSessionIdentity));
    setAgentMention(undefined);
    setSlashCommandQuery(undefined);
    setSelectedAgentMentions([]);
    const key = state.selectedSessionKey;
    if (key === undefined || client === undefined || typeof client.listMessageStashes !== "function") { setStashes([]); return; }
    void client.listMessageStashes(key).then(setStashes).catch(() => setStashes([]));
  }, [client, selectedSessionIdentity]);

  useEffect(() => {
    void fetch("/v2/voice/settings", { headers: { Accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() as Promise<{ settings: { openAiKeyConfigured: boolean; maxRecordingSeconds: number; speechModel: string; speechSpeed: number; speechVoice: string; voiceAutoplay: boolean } }> : undefined)
      .then((body) => {
        if (body !== undefined) {
          setVoiceConfiguration({ configured: body.settings.openAiKeyConfigured, maximumSeconds: body.settings.maxRecordingSeconds, playbackSpeed: body.settings.speechSpeed, speechModel: body.settings.speechModel, speechVoice: body.settings.speechVoice });
          setVoiceAutoplay(body.settings.voiceAutoplay);
          if (!body.settings.openAiKeyConfigured) setVoiceMode(false);
        }
      })
      .catch(() => undefined);
  }, []);


  useEffect(() => {
    const cancelRecording = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && voiceRecorder.current !== undefined) {
        event.preventDefault();
        stopVoiceRecording(false);
      }
    };
    window.addEventListener("keydown", cancelRecording);
    return () => {
      window.removeEventListener("keydown", cancelRecording);
      const recorder = voiceRecorder.current;
      if (recorder !== undefined && recorder.state !== "inactive") recorder.stop();
      releaseVoiceRecorder();
    };
  }, []);

  useEffect(() => {
    if (dirtySessionEditors.size === 0) return;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtySessionEditors]);

  useEffect(() => {
    if (
      initialPaintReported.current
      || state.connection !== "ready"
      || state.selected.sessionKey === undefined
    ) return;
    initialPaintReported.current = true;
    let reported = false;
    const report = () => {
      if (reported) return;
      reported = true;
      onInitialPaint?.(state.selected.timeline.length);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(report);
    window.setTimeout(report, 250);
  }, [onInitialPaint, state.connection, state.selected.sessionKey, state.selected.timeline.length]);
  const sessionVisitOrder = useRef<string[]>([]);
  const lastSelectedSummary = useRef<SessionSummary | undefined>(undefined);
  const handledClosedSelection = useRef<string | undefined>(undefined);
  const cloneSource = useRef<{
    source: SessionKey
    workingDirectory: string
    cloneName: string
  } | undefined>(undefined);
  const historyScrollAnchor = useRef<{
    height: number
    y: number
  } | undefined>(undefined);
  const [workingDelivery, setWorkingDelivery] = useState<"prompt.steer" | "prompt.follow-up">("prompt.steer");
  const [queuedInputs, setQueuedInputs] = useState<readonly {
    readonly requestId: string
    readonly text: string
    readonly delivery: "prompt.steer" | "prompt.follow-up"
    readonly baselineMatches: number
    readonly status: "submitting" | "queued"
  }[]>([]);
  const [clearQueueRequestId, setClearQueueRequestId] = useState<string>();

  const newSessionRequest = newSessionRequestId === undefined
    ? undefined
    : state.managedSessionCreates?.[newSessionRequestId];
  const newSessionPending = newSessionRequest?.status === "starting";
  const newSessionError = newSessionRequest?.result?.status === "outcome-unknown"
    ? "Pi may have started, but Pi Station has not confirmed the Session yet."
    : newSessionRequest?.result?.status === "rejected"
      || newSessionRequest?.result?.status === "retryable"
      ? newSessionRequest.result.error.message
      : undefined;

  useEffect(() => {
    if (newSessionRequest?.status !== "succeeded") return;
    if (newSessionRequest.result?.status === "succeeded") {
      const createdKey = newSessionRequest.result.sessionKey;
      afterSharedMarkdownCheck(() => openSession(createdKey));
    }
    setNewSessionProject(undefined);
    setNewSessionRequestId(undefined);
  }, [newSessionRequest?.status]);

  const resumeSessionRequest = resumeSessionRequestId === undefined
    ? undefined
    : state.managedSessionCreates?.[resumeSessionRequestId];
  useEffect(() => {
    if (resumeSessionRequest?.result?.status !== "succeeded") return;
    focusComposerForSession.current = isDesktopViewport()
      ? resumeSessionRequest.result.sessionKey
      : undefined;
    const resumedKey = resumeSessionRequest.result.sessionKey;
    afterSharedMarkdownCheck(() => openSession(resumedKey));
    setResumeSessionRequestId(undefined);
  }, [resumeSessionRequest?.result]);

  const selectedSummary = state.selectedSessionKey
    ? state.sessions.find((session) =>
        sessionKeysEqual(session.sessionKey, state.selectedSessionKey!),
      )
    : undefined;
  if (selectedSummary !== undefined) lastSelectedSummary.current = selectedSummary;

  useEffect(() => {
    const update = (): void => {
      const pageHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
      const follows = pageHeight - window.scrollY - window.innerHeight <= 120;
      followsLatest.current = follows;
      setShowJumpToLatest(!follows);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useLayoutEffect(() => {
    followsLatest.current = true;
    setShowJumpToLatest(false);
    if (route !== "workspace") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [
    route,
    state.selectedSessionKey?.hostId,
    state.selectedSessionKey?.piSessionId,
  ]);

  useLayoutEffect(() => {
    const input = composerInput.current;
    if (input === null) return;

    const desktop = window.matchMedia?.("(min-width: 1100px)");
    const resize = (): void => {
      input.style.height = "auto";
      if (desktop?.matches ?? window.innerWidth >= 1100) {
        input.style.height = `${Math.min(input.scrollHeight, window.innerHeight / 2)}px`;
      } else {
        input.style.removeProperty("height");
      }
    };

    resize();
    window.addEventListener("resize", resize);
    desktop?.addEventListener("change", resize);
    return () => {
      window.removeEventListener("resize", resize);
      desktop?.removeEventListener("change", resize);
    };
  }, [draft, route, selectedSessionIdentity, voiceMode]);

  useLayoutEffect(() => {
    const shell = composerShell.current;
    const session = sessionContainer.current;
    if (shell === null || session === null) return;

    const updateSpacing = (): void => {
      session.style.setProperty("--composer-shell-height", `${shell.getBoundingClientRect().height}px`);
    };
    updateSpacing();

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateSpacing);
    observer?.observe(shell);
    window.addEventListener("resize", updateSpacing);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSpacing);
    };
  }, [route, selectedSessionIdentity]);

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 1099px)");
    if (query === undefined) return;
    const update = (): void => setMobileTimeline(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setVisibleTimelineItems(mobileTimeline ? 120 : 300);
  }, [
    mobileTimeline,
    state.selectedSessionKey?.hostId,
    state.selectedSessionKey?.piSessionId,
  ]);

  useEffect(() => {
    if (
      route !== "workspace"
      || state.selectedSessionKey === undefined
      || !window.matchMedia?.("(max-width: 1099px)").matches
    ) return;

    const edgeWidth = 24;
    const completionDistance = 96;
    const verticalCancellationDistance = 40;
    const interactiveSelector = "a, button, input, textarea, select, label, [contenteditable='true'], [role='button'], [role='slider'], [role='textbox'], .composer";
    const overlaySelector = "dialog[open], .palette-backdrop, .editor-open, .details-open";
    let gesture: { identifier: number; startX: number; startY: number; cancelled: boolean } | undefined;

    const overlayOpen = (): boolean => document.querySelector(overlaySelector) !== null;
    const start = (event: TouchEvent): void => {
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target : undefined;
      gesture = undefined;
      if (
        event.touches.length !== 1
        || touch === undefined
        || touch.clientX > edgeWidth
        || (target !== undefined && target.closest(interactiveSelector) !== null)
        || overlayOpen()
      ) return;
      gesture = { identifier: touch.identifier, startX: touch.clientX, startY: touch.clientY, cancelled: false };
    };
    const move = (event: TouchEvent): void => {
      if (gesture === undefined || gesture.cancelled || event.touches.length !== 1 || overlayOpen()) {
        gesture = undefined;
        return;
      }
      const touch = Array.from(event.touches).find(({ identifier }) => identifier === gesture?.identifier);
      if (touch === undefined) { gesture = undefined; return; }
      const dx = touch.clientX - gesture.startX;
      const dy = Math.abs(touch.clientY - gesture.startY);
      if (dx < -8 || (dy > verticalCancellationDistance && dy >= dx)) {
        gesture.cancelled = true;
        return;
      }
      if (dx >= 12 && dx > dy * 1.5) event.preventDefault();
    };
    const end = (event: TouchEvent): void => {
      const current = gesture;
      gesture = undefined;
      if (current === undefined || current.cancelled || overlayOpen()) return;
      const touch = Array.from(event.changedTouches).find(({ identifier }) => identifier === current.identifier);
      if (touch === undefined) return;
      const dx = touch.clientX - current.startX;
      const dy = Math.abs(touch.clientY - current.startY);
      if (dx >= completionDistance && dx > dy * 1.75 && dy <= verticalCancellationDistance) {
        event.preventDefault();
        setRoute("dashboard");
      }
    };
    const cancel = (): void => { gesture = undefined; };

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: false });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [
    detailsOpen,
    paletteOpen,
    route,
    sharedMarkdownFile,
    sharedMarkdownDirty,
    state.selectedSessionKey,
  ]);

  useLayoutEffect(() => {
    const previousLength = previousTimelineLength.current;
    const nextLength = state.selected.timeline.length;
    previousTimelineLength.current = nextLength;
    const anchor = historyScrollAnchor.current;
    if (nextLength <= previousLength) return;
    if (anchor === undefined) {
      const threshold = mobileTimeline ? 160 : 300;
      const limit = mobileTimeline ? 120 : 300;
      if (followsLatest.current) {
        setVisibleTimelineItems((current) => current > threshold ? limit : current);
      }
      return;
    }
    setVisibleTimelineItems((current) => current + nextLength - previousLength);
    requestAnimationFrame(() => {
      window.scrollTo({
        top: anchor.y + document.body.scrollHeight - anchor.height,
        behavior: "auto",
      });
      historyScrollAnchor.current = undefined;
    });
  }, [mobileTimeline, state.selected.timeline.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        setPaletteInitialFlow("actions");
        setPaletteOpen(true);
      } else if (
        event.key === "Escape"
        && !paletteOpenRef.current
        && document.querySelector(".palette-backdrop") === null
      ) {
        setDetailsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const discardImage = (image: typeof images[number]): void => {
    image.controller.abort();
    URL.revokeObjectURL(image.previewUrl);
    if (image.uploadId !== undefined) {
      void onDeleteImage?.(image.uploadId).catch(() => undefined);
    }
    setImages((current) => current.filter((candidate) => candidate.localId !== image.localId));
  };

  const addImages = (selected: readonly File[]): void => {
    const supported = new Set(["image/png", "image/jpeg", "image/webp"]);
    const available = Math.max(0, 4 - images.length - files.length);
    if (selected.length > available) setAttachmentError("You can attach up to four combined files and images.");
    for (const file of selected.slice(0, available)) {
      if (!supported.has(file.type)) { setAttachmentError("Use PNG, JPEG, or WebP images."); continue; }
      if (file.size > 10 * 1024 * 1024) { setAttachmentError(`${file.name} is larger than 10 MB.`); continue; }
      const localId = crypto.randomUUID();
      const controller = new AbortController();
      const item = { localId, name: file.name || "Image", previewUrl: URL.createObjectURL(file), controller, status: "uploading" as const };
      setImages((current) => [...current, item]);
      void (onUploadImage === undefined
        ? Promise.reject(new Error("Image upload is unavailable."))
        : onUploadImage(file, controller.signal))
        .then((uploadId) => {
          setImages((current) => current.map((candidate) => candidate.localId === localId ? { ...candidate, status: "ready", uploadId } : candidate));
          setAttachmentError(undefined);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          const message = cause instanceof Error ? cause.message : "Image upload failed.";
          setImages((current) => current.map((candidate) => candidate.localId === localId ? { ...candidate, status: "error", error: message } : candidate));
          setAttachmentError(message);
        });
    }
  };

  const discardFile = (file: typeof files[number]): void => {
    file.controller.abort(); if (file.uploadId !== undefined) void onDeleteAttachment?.(file.uploadId).catch(() => undefined);
    setFiles((current) => current.filter((candidate) => candidate.localId !== file.localId));
  };
  const addFiles = (selected: readonly File[]): void => {
    const available = Math.max(0, 4 - images.length - files.length);
    if (selected.length > available) setAttachmentError("You can attach up to four combined files and images.");
    for (const file of selected.slice(0, available)) {
      if (file.size > 25 * 1024 * 1024) { setAttachmentError(`${file.name} is larger than 25 MB.`); continue; }
      const localId = crypto.randomUUID(); const controller = new AbortController();
      setFiles((current) => [...current, { localId, name: file.name || "File", size: file.size, controller, status: "uploading" }]);
      void (onUploadAttachment?.(file, controller.signal) ?? Promise.reject(new Error("File upload is unavailable."))).then((uploadId) => {
        setFiles((current) => current.map((candidate) => candidate.localId === localId ? { ...candidate, status: "ready", uploadId } : candidate)); setAttachmentError(undefined);
      }).catch((cause: unknown) => { if (cause instanceof DOMException && cause.name === "AbortError") return; const message = cause instanceof Error ? cause.message : "File upload failed."; setFiles((current) => current.map((candidate) => candidate.localId === localId ? { ...candidate, status: "error", error: message } : candidate)); setAttachmentError(message); });
    }
  };

  const addSelectedAttachments = (selected: readonly File[]): void => {
    const available = Math.max(0, 4 - images.length - files.length);
    if (selected.length > available) setAttachmentError("You can attach up to four combined files and images.");
    const allowed = selected.slice(0, available);
    const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    addImages(allowed.filter((file) => imageTypes.has(file.type)));
    addFiles(allowed.filter((file) => !imageTypes.has(file.type)));
  };

  const stashComposer = async (): Promise<void> => {
    const key = state.selectedSessionKey;
    const readyImages = images.filter((image) => image.status === "ready" && image.uploadId !== undefined);
    const readyFiles = files.filter((file) => file.status === "ready" && file.uploadId !== undefined);
    if (key === undefined || client === undefined || stashPending || (draft.trim().length === 0 && readyImages.length === 0 && readyFiles.length === 0)) return;
    if (images.some((image) => image.status !== "ready") || files.some((file) => file.status !== "ready")) { toast({ message: "Wait for uploads to finish before stashing.", variant: "info" }); return; }
    setStashPending(true);
    try {
      const stash = await client.createMessageStash(key, { text: draft, imageIds: readyImages.map((image) => image.uploadId!), attachmentIds: readyFiles.map((file) => file.uploadId!) });
      for (const image of images) { image.controller.abort(); URL.revokeObjectURL(image.previewUrl); }
      for (const file of files) file.controller.abort();
      setImages([]); setFiles([]); setDraft(""); writeComposerDraft(selectedSessionIdentity, "");
      setStashes((current) => [...current, stash]); toast({ message: "Message stashed.", variant: "success" });
      requestAnimationFrame(() => composerInput.current?.focus());
    } catch (error) { toast({ message: error instanceof Error ? error.message : "Message could not be stashed.", variant: "error" }); }
    finally { setStashPending(false); }
  };

  const restoreStash = async (stash: MessageStash): Promise<void> => {
    const key = state.selectedSessionKey;
    if (key === undefined || client === undefined || stashPending) return;
    const hasContent = draft.trim().length > 0 || images.length > 0 || files.length > 0;
    if (hasContent && !window.confirm("Append this stashed message to the current composer?")) return;
    setStashPending(true);
    try {
      const consumed = await client.consumeMessageStash(key, stash.id);
      const separator = draft.length > 0 && consumed.stash.text.length > 0 ? "\n\n" : "";
      const nextDraft = `${draft}${separator}${consumed.stash.text}`;
      setDraft(nextDraft); writeComposerDraft(selectedSessionIdentity, nextDraft);
      setImages((current) => [...current, ...consumed.stash.images.flatMap((image, index) => { const uploadId = consumed.imageIds[index]; return uploadId === undefined ? [] : [{ localId: crypto.randomUUID(), name: image.name, previewUrl: `/v2/projects/${encodeURIComponent(key.hostId)}/sessions/${encodeURIComponent(key.piSessionId)}/attachments/${encodeURIComponent(image.id)}`, controller: new AbortController(), status: "ready" as const, uploadId }]; })]);
      setFiles((current) => [...current, ...consumed.stash.attachments.map((file) => ({ localId: crypto.randomUUID(), name: file.name, size: file.size, controller: new AbortController(), status: "ready" as const, uploadId: file.id }))]);
      setStashes((current) => current.filter((item) => item.id !== stash.id)); setPaletteOpen(false); toast({ message: "Stashed message restored.", variant: "success" });
      requestAnimationFrame(() => composerInput.current?.focus());
    } catch (error) { toast({ message: error instanceof Error ? error.message : "Stashed message could not be restored.", variant: "error" }); }
    finally { setStashPending(false); }
  };

  useEffect(() => {
    const handleStashShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "s") return;
      if (route !== "workspace" || state.selectedSessionKey === undefined || voiceMode || paletteOpenRef.current || document.querySelector("dialog[open], .editor-open, .details-open") !== null) return;
      event.preventDefault();
      if (draft.trim().length === 0 && images.length === 0 && files.length === 0) {
        setPaletteInitialFlow("stashes");
        setPaletteOpen(true);
        return;
      }
      void stashComposer();
    };
    window.addEventListener("keydown", handleStashShortcut);
    return () => window.removeEventListener("keydown", handleStashShortcut);
  }, [client, draft, files, images, route, stashPending, state.selectedSessionKey, voiceMode]);

  const addPastedAttachments = (clipboard: DataTransfer): boolean => {
    const files = [...clipboard.files];
    if (files.length > 0) {
      addSelectedAttachments(files);
      return true;
    }
    const itemFiles = [...clipboard.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (itemFiles.length > 0) {
      addSelectedAttachments(itemFiles);
      return true;
    }
    const uri = clipboard.getData("text/uri-list").split(/\r?\n/u).find((line) => line.startsWith("file://"));
    return uri !== undefined && /\.(?:gif|jpe?g|png|webp)(?:$|[?#])/iu.test(uri);
  };

  const openSession = (sessionKey: SessionKey, addToWorkspace = true): void => {
    const target = state.sessions.find((session) => sessionKeysEqual(session.sessionKey, sessionKey));
    if (addToWorkspace && client !== undefined && activeWorkspace !== undefined) {
      const tab = activeWorkspace.tabs.find(({ projectId, sessionId }) => projectId === sessionKey.hostId && sessionId === sessionKey.piSessionId);
      const operation = tab === undefined
        ? client.openSessionInWorkspace(activeWorkspace.id, sessionKey.hostId, sessionKey.piSessionId)
        : client.selectWorkspaceTab(activeWorkspace.id, tab.id);
      void operation.then(() => openSession(sessionKey, false)).catch((reason: unknown) => toast({
        message: reason instanceof Error ? reason.message : "Session could not be opened in this Workspace.",
        variant: "error",
      }));
      return;
    }
    const project = target === undefined
      ? undefined
      : state.projects.find((candidate) => candidate.projectId === target.projectId);
    if (target?.projection.availability === "closed") {
      const workingDirectory = project?.displayPath ?? target.displayPath;
      if (workingDirectory === undefined) return;
      const requestId = onCreateManagedSession?.(workingDirectory, target.name, sessionKey);
      if (requestId !== undefined) setResumeSessionRequestId(requestId);
      return;
    }
    focusComposerForSession.current = isDesktopViewport() ? sessionKey : undefined;
    onSelect(sessionKey);
    setSubmittedRequestId(undefined);
    setOptimisticPrompt(undefined);
    setPendingAgentActivity(undefined);
    setQueuedInputs([]);
    setDetailsOpen(false);
    setRouteState("workspace");
  };

  const openActivitySession = async (session: SessionSummary): Promise<void> => {
    if (client === undefined) { openSession(session.sessionKey, false); return; }
    const workspaces = applicationState.workspaces ?? [];
    const match = activityWorkspaceTarget(workspaces, applicationState.activeWorkspaceId, session.sessionKey, workspaceMru.current);
    if (match !== undefined) {
      if (match.workspace.id !== applicationState.activeWorkspaceId) await client.activateWorkspace(match.workspace.id);
      await client.selectWorkspaceTab(match.workspace.id, match.tab.id);
      openSession(session.sessionKey, false);
      return;
    }
    const currentOpenWorkspace = workspaces.find((workspace) => workspace.id === applicationState.activeWorkspaceId && workspace.closedAt === undefined)
      ?? workspaces.find((workspace) => workspace.closedAt === undefined);
    if (currentOpenWorkspace === undefined) throw new Error("No open Workspace is available.");
    if (currentOpenWorkspace.id !== applicationState.activeWorkspaceId) await client.activateWorkspace(currentOpenWorkspace.id);
    await client.openSessionInWorkspace(currentOpenWorkspace.id, session.sessionKey.hostId, session.sessionKey.piSessionId);
    openSession(session.sessionKey, false);
  };

  const handledSessionRequest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (requestedSessionKey === undefined) { handledSessionRequest.current = undefined; return; }
    if (client === undefined || activeWorkspace === undefined || state.connection !== "ready") return;
    const identity = `${requestedSessionKey.hostId}:${requestedSessionKey.piSessionId}`;
    if (handledSessionRequest.current === identity) return;
    const target = state.sessions.find((session) => sessionKeysEqual(session.sessionKey, requestedSessionKey));
    if (target === undefined) return;
    handledSessionRequest.current = identity;
    afterSharedMarkdownCheck(() => {
      void client.openSessionInWorkspace(activeWorkspace.id, requestedSessionKey.hostId, requestedSessionKey.piSessionId)
        .then(() => { openSession(requestedSessionKey, false); onRequestedSessionOpened?.(); })
        .catch((reason: unknown) => {
          handledSessionRequest.current = undefined;
          toast({ message: reason instanceof Error ? reason.message : "Session could not be opened.", variant: "error" });
        });
    });
  }, [requestedSessionKey, state.connection, state.sessions, activeWorkspace, client]);

  const closeSessionCommand = closeSessionRequestId === undefined
    ? undefined
    : state.commands?.[closeSessionRequestId];
  const closeSessionPending = closeSessionCommand?.status === "queued"
    || closeSessionCommand?.status === "accepted";
  const selectedSessionName = [state.selected.details?.name, selectedSummary?.name]
    .find((name) => name?.trim())?.trim();
  const closeSessionName = closeSessionTarget === undefined
    ? selectedSessionName
    : closeSessionTarget.name?.trim();
  const closeSessionTitle = closeSessionName
    ? `Close ${closeSessionName}?`
    : "Close this Session?";
  const closeSessionError = closeSessionCommand?.status === "not-accepted"
    ? closeSessionCommand.error?.message ?? "Pi Station could not close this Session."
    : commandOutcomeError(closeSessionCommand?.result?.outcome);
  const respondToCommandApproval = (allowed: boolean): void => {
    const approval = state.selected.commandApproval;
    if (approval === undefined || client === undefined || commandApprovalPending) return;
    setCommandApprovalPending(true);
    setCommandApprovalError(undefined);
    void client.respondToCommandApproval(approval.id, allowed)
      .catch((error: unknown) => setCommandApprovalError(error instanceof Error ? error.message : "Could not respond to the command approval."))
      .finally(() => setCommandApprovalPending(false));
  };
  const cloneSessionCommand = cloneSessionRequestId === undefined
    ? undefined
    : state.commands?.[cloneSessionRequestId];
  const reloadSessionCommand = reloadSessionRequestId === undefined
    ? undefined
    : state.commands?.[reloadSessionRequestId];
  const reloadSessionPending = reloadSessionCommand?.status === "queued"
    || reloadSessionCommand?.status === "accepted";
  const reloadSessionError = reloadSessionCommand?.status === "not-accepted"
    ? reloadSessionCommand.error?.message ?? "Pi Station could not reload this Pi Session."
    : commandOutcomeError(reloadSessionCommand?.result?.outcome);
  const restartSessionRequest = restartSessionRequestId === undefined ? undefined : state.managedSessionRestarts?.[restartSessionRequestId];
  const restartSessionPending = restartSessionRequest?.status === "restarting";
  const restartSessionError = restartSessionLaunchError ?? (
    restartSessionRequest?.result !== undefined && restartSessionRequest.result.status !== "succeeded"
      ? restartSessionRequest.result.error.message
      : undefined
  );
  const restartSessionSucceeded = restartSessionRequest?.status === "succeeded";
  const restartSessionOutcomeUnknown = restartSessionRequest?.status === "outcome-unknown";
  const sessionSettingCommand = sessionSettingRequestId === undefined
    ? undefined
    : state.commands?.[sessionSettingRequestId];
  const sessionSettingPending = sessionSettingCommand?.status === "queued"
    || sessionSettingCommand?.status === "accepted";
  const sessionSettingError = sessionSettingCommand?.status === "not-accepted"
    ? sessionSettingCommand.error?.message
      ?? "Pi Station could not change this Session setting."
    : sessionSettingCommand?.result?.outcome.status === "outcome-unknown"
      ? "Pi may have applied the change, but Pi Station could not confirm it."
      : sessionSettingCommand?.result?.outcome.status === "stale-generation"
        ? "This Session changed before Pi Station could apply the setting."
        : sessionSettingCommand?.result?.outcome.status === "rejected"
          || sessionSettingCommand?.result?.outcome.status === "retryable"
          ? sessionSettingCommand.result.outcome.error.message
          : undefined;
  const detailsBookmarkMutation = detailsBookmarkRequestId === undefined
    ? undefined
    : state.bookmarkMutations[detailsBookmarkRequestId];
  const selectedProject = state.projects.find((project) => (
    project.projectId === (
      state.selected.details?.projectId ?? selectedSummary?.projectId
    )
  ));
  const selectedDevelopmentServer = state.developmentServers.find(
    (server) => server.projectId === selectedProject?.projectId,
  );
  const developmentServerRequest = developmentServerRequestId === undefined
    ? undefined
    : state.developmentServerRequests[developmentServerRequestId];
  const developmentServerPending = developmentServerRequest?.status === "loading";
  const developmentServerError = developmentServerRequest?.result?.status === "rejected"
    || developmentServerRequest?.result?.status === "retryable"
    ? developmentServerRequest.result.error.message
    : undefined;
  const selectedSessionBookmarked = selectedSummary !== undefined
    && state.sessionBookmarks.some((bookmark) => (
      bookmark.projectId === selectedSummary.projectId
      && sessionKeysEqual(bookmark.sessionKey, selectedSummary.sessionKey)
    ));

  useEffect(() => {
    if (state.selectedSessionKey === undefined) return;
    const identity = sessionIdentity(state.selectedSessionKey);
    sessionVisitOrder.current = [
      identity,
      ...sessionVisitOrder.current.filter((item) => item !== identity),
    ];
  }, [state.selectedSessionKey]);

  useLayoutEffect(() => {
    // A closed Session remains a readable tab. Closing it must not open unrelated work.
    if (activeWorkspace !== undefined) return;
    const selectedKey = state.selectedSessionKey;
    if (selectedKey === undefined) {
      handledClosedSelection.current = undefined;
      return;
    }
    const identity = sessionIdentity(selectedKey);
    const current = state.sessions.find((session) => sessionKeysEqual(session.sessionKey, selectedKey));
    if (current === undefined) return;
    if (current.projection.availability === "available") {
      handledClosedSelection.current = undefined;
      return;
    }
    if (current.projection.availability !== "closed") return;
    const isProjectlessBookmark = !state.projects.some((project) => (
      project.projectId === current.projectId
    )) && state.sessionBookmarks.some((bookmark) => (
      bookmark.projectId === current.projectId
      && sessionKeysEqual(bookmark.sessionKey, current.sessionKey)
    ));
    if (isProjectlessBookmark) return;
    if (handledClosedSelection.current === identity) return;
    handledClosedSelection.current = identity;

    const closed = current ?? (
      sessionKeysEqual(lastSelectedSummary.current?.sessionKey ?? selectedKey, selectedKey)
        ? lastSelectedSummary.current
        : undefined
    );
    const open = state.sessions.filter((session) => (
      session.projection.availability === "available"
      && !sessionKeysEqual(session.sessionKey, selectedKey)
    ));
    const parent = closed?.parentSessionKey === undefined
      ? undefined
      : open.find((session) => sessionKeysEqual(session.sessionKey, closed.parentSessionKey!));
    const openByIdentity = new Map(open.map((session) => [sessionIdentity(session.sessionKey), session] as const));
    const previouslyViewed = sessionVisitOrder.current
      .filter((visited) => visited !== identity)
      .map((visited) => openByIdentity.get(visited))
      .find((session) => session !== undefined);
    const sameProject = closed?.projectId === undefined
      ? undefined
      : open
          .filter((session) => session.projectId === closed.projectId)
          .sort((left, right) => sessionTime(right.lastActivityAt) - sessionTime(left.lastActivityAt))[0];
    const redirect = parent ?? previouslyViewed ?? sameProject;

    if (redirect !== undefined) {
      afterSharedMarkdownCheck(() => openSession(redirect.sessionKey));
    } else if (
      closed?.projectId !== undefined
      && state.projects.some((project) => project.projectId === closed.projectId)
    ) {
      setSelectedProjectId(closed.projectId);
      setRouteState("project");
    } else {
      setRouteState("dashboard");
    }
  }, [activeWorkspace, state.projects, state.selectedSessionKey, state.sessionBookmarks, state.sessions]);

  useEffect(() => {
    const tracking = cloneSource.current;
    const outcome = cloneSessionCommand?.result?.outcome;
    if (tracking === undefined || outcome === undefined) return;
    if (outcome.status !== "succeeded" || outcome.effect.kind !== "clone-created") {
      cloneSource.current = undefined;
      return;
    }
    cloneSource.current = undefined;
    setCloneSessionRequestId(undefined);
    const requestId = onCreateManagedSession?.(
      tracking.workingDirectory,
      tracking.cloneName,
      { hostId: tracking.source.hostId, piSessionId: outcome.effect.piSessionId },
    );
    if (requestId !== undefined) setResumeSessionRequestId(requestId);
  }, [cloneSessionCommand?.result]);

  const requestSessionClose = (): void => {
    const target = closeSessionTarget ?? selectedSummary;
    if (target === undefined) return;
    const requestId = closeSessionTarget === undefined
      ? onCommand?.({ kind: "session.close" })
      : onCommand?.({ kind: "session.close" }, target.sessionKey);
    if (requestId === undefined) return;
    setCloseSessionRequestId(requestId);
  };

  useEffect(() => {
    const outcome = closeSessionCommand?.result?.outcome.status;
    if (outcome === "succeeded") {
      setCloseSessionConfirmOpen(false);
      setCloseSessionTarget(undefined);
      setDetailsOpen(false);
      setPaletteOpen(false);
    }
  }, [
    closeSessionCommand?.status,
    closeSessionCommand?.result?.outcome.status,
  ]);

  useEffect(() => {
    if (sessionSettingCommand?.result?.outcome.status === "succeeded") {
      setPaletteOpen(false);
    }
  }, [sessionSettingCommand?.result?.outcome.status]);

  const runState = state.selected.projection?.run;
  const working =
    runState !== undefined &&
    ["working", "aborting", "settling"].includes(runState);
  const synchronized =
    state.connection === "ready" &&
    state.selected.projection?.synchronization === "synchronized";
  const capabilities: readonly string[] =
    state.selected.projection?.capabilities ?? [];
  const delivery = working ? workingDelivery : "prompt.send";
  const requiredCapability = working
    ? workingDelivery === "prompt.steer" ? "session.prompt.steer" : "session.prompt.follow-up"
    : "session.prompt.text";
  const commandAvailable = synchronized && capabilities.includes(requiredCapability);

  useEffect(() => {
    const editableSelector = [
      "input",
      "textarea",
      "select",
      "[contenteditable]:not([contenteditable='false'])",
      "[role='textbox']",
      "[role='combobox']",
      "[role='spinbutton']",
      ".composer",
      ".markdown-source-editor",
      ".cm-editor",
      ".monaco-editor",
      ".CodeMirror",
    ].join(", ");
    const overlaySelector = [
      "dialog[open]",
      "[role='dialog']",
      "[role='menu']",
      ".palette-backdrop",
      ".details-open",
      ".editor-open",
    ].join(", ");
    const handleCloseShortcut = (event: KeyboardEvent): void => {
      if (
        event.key.toLowerCase() !== "w"
        || !event.shiftKey
        || (!event.ctrlKey && !event.metaKey)
        || (event.ctrlKey && event.metaKey)
        || event.altKey
        || route !== "workspace"
        || selectedSummary === undefined
        || !synchronized
        || !capabilities.includes("session.close")
        || document.querySelector(overlaySelector) !== null
      ) return;
      const target = event.target instanceof Element ? event.target : undefined;
      const focused = document.activeElement instanceof Element ? document.activeElement : undefined;
      if (
        (target !== undefined && target.closest(editableSelector) !== null)
        || (focused !== undefined && focused.closest(editableSelector) !== null)
      ) return;

      event.preventDefault();
      setCloseSessionRequestId(undefined);
      setCloseSessionTarget(undefined);
      setCloseSessionConfirmOpen(true);
    };
    window.addEventListener("keydown", handleCloseShortcut);
    return () => window.removeEventListener("keydown", handleCloseShortcut);
  }, [capabilities, route, selectedSummary, synchronized]);

  useEffect(() => {
    const target = focusComposerForSession.current;
    if (
      target === undefined
      || paletteOpen
      || !commandAvailable
      || state.selectedSessionKey === undefined
      || !sessionKeysEqual(target, state.selectedSessionKey)
    ) return;
    focusComposerForSession.current = undefined;
    composerInput.current?.focus();
  }, [commandAvailable, paletteOpen, route, state.selectedSessionKey]);

  useEffect(() => {
    const desktop = (): boolean => window.matchMedia?.("(min-width: 1100px)").matches
      ?? window.innerWidth >= 1100;
    const hideShortcuts = (): void => setSessionShortcutsVisible(false);
    const navigateSessions = (event: KeyboardEvent): void => {
      if (event.key === "Meta" || event.key === "Control") {
        setSessionShortcutsVisible(desktop() && route === "workspace");
        return;
      }
      if (
        (!event.metaKey && !event.ctrlKey)
        || event.altKey
        || event.isComposing
        || !desktop()
        || route !== "workspace"
        || document.querySelector("dialog[open]")
      ) return;

      const eventTarget = event.target;
      if (eventTarget instanceof Element && eventTarget.closest("input, textarea, select, [contenteditable='true']") !== null) return;
      if (paletteOpenRef.current || document.querySelector("[role='dialog'], [role='menu']") !== null) return;
      const projectOptions = [...document.querySelectorAll<HTMLButtonElement>(
        ".sidebar .workspace-tab-open[data-session-shortcut]",
      )];
      const numberMatch = event.code.match(/^(?:Digit|Numpad)([1-9])$/);
      if (numberMatch !== null) {
        const target = projectOptions[Number(numberMatch[1]) - 1];
        if (target === undefined) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        target.click();
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const options = [...document.querySelectorAll<HTMLButtonElement>(
        ".sidebar [data-activity-session='true'][data-session-identity]",
      )];
      if (options.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const currentIdentity = state.selectedSessionKey === undefined
        ? undefined
        : `${state.selectedSessionKey.hostId}:${state.selectedSessionKey.piSessionId}`;
      const currentIndex = options.findIndex((option) => option.dataset.sessionIdentity === currentIdentity);
      const step = key === "j" ? 1 : -1;
      const target = currentIndex < 0
        ? options[key === "j" ? 0 : options.length - 1]
        : options[(currentIndex + step + options.length) % options.length];
      if (target === undefined || target === options[currentIndex]) return;
      target.click();
      target.scrollIntoView?.({ block: "nearest" });
    };
    const releaseModifier = (event: KeyboardEvent): void => {
      if (event.key === "Meta" || event.key === "Control") hideShortcuts();
    };

    document.addEventListener("keydown", navigateSessions, true);
    document.addEventListener("keyup", releaseModifier, true);
    window.addEventListener("blur", hideShortcuts);
    return () => {
      document.removeEventListener("keydown", navigateSessions, true);
      document.removeEventListener("keyup", releaseModifier, true);
      window.removeEventListener("blur", hideShortcuts);
    };
  }, [route, state.selectedSessionKey]);

  useEffect(() => {
    if (route !== "workspace") setSessionShortcutsVisible(false);
  }, [route]);

  useEffect(() => {
    const focusComposer = (event: KeyboardEvent): void => {
      if (
        event.key !== "Enter"
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || event.shiftKey
        || event.isComposing
        || route !== "workspace"
        || !commandAvailable
        || document.querySelector("dialog[open]")
      ) return;

      const target = event.target;
      if (
        target instanceof Element
        && target.closest("input, textarea, select, button, [contenteditable='true']")
      ) return;

      event.preventDefault();
      const input = composerInput.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    };

    window.addEventListener("keydown", focusComposer);
    return () => window.removeEventListener("keydown", focusComposer);
  }, [commandAvailable, route]);

  useEffect(() => {
    const navigateEditor = (event: KeyboardEvent): void => {
      if (
        (!event.metaKey && !event.ctrlKey)
        || event.altKey
        || event.shiftKey
        || event.isComposing
        || route !== "workspace"
        || document.querySelector("dialog[open]")
      ) return;
      const key = event.key.toLowerCase();
      const target = event.target instanceof Element ? event.target : undefined;
      const fromComposer = target?.closest(".composer") !== null && target?.closest(".composer") !== undefined;
      const fromEditor = target?.closest(".markdown-source-editor") !== null && target?.closest(".markdown-source-editor") !== undefined;
      const wantsComposer = key === "m" || (key === "h" && fromEditor);
      const wantsEditor = key === "e" || (key === "l" && fromComposer);
      if (wantsComposer && commandAvailable) {
        event.preventDefault();
        event.stopPropagation();
        const input = composerInput.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
        if (input !== null) {
          const repaintCaret = (release: KeyboardEvent): void => {
            if (release.key !== "Control" && release.key !== "Meta") return;
            window.removeEventListener("keyup", repaintCaret, true);
            requestAnimationFrame(() => {
              if (document.activeElement !== input) return;
              const caret = input.selectionEnd ?? input.value.length;
              input.style.caretColor = "transparent";
              void input.offsetWidth;
              input.style.removeProperty("caret-color");
              input.setSelectionRange(caret, caret);
            });
          };
          window.addEventListener("keyup", repaintCaret, true);
        }
        return;
      }
      if (wantsEditor && sharedMarkdownFile !== undefined) {
        const editor = document.querySelector<HTMLElement>(".markdown-source-editor [contenteditable='true']");
        if (editor === null) return;
        event.preventDefault();
        event.stopPropagation();
        editor.focus();
      }
    };

    document.addEventListener("keydown", navigateEditor, true);
    return () => document.removeEventListener("keydown", navigateEditor, true);
  }, [commandAvailable, route, sharedMarkdownFile]);

  const submitted = submittedRequestId === undefined
    ? undefined
    : state.commands?.[submittedRequestId];
  const commandPending = submitted?.status === "queued" || submitted?.status === "accepted" || sessionSettingPending;

  useEffect(() => {
    if (submittedRequestId === undefined || submitted === undefined) return
    if (submitted.status === "accepted") {
      setQueuedInputs((current) => current.map((item) => (
        item.requestId === submittedRequestId
          ? { ...item, status: "queued" }
          : item
      )))
    }
    if (submitted.status === "not-accepted") {
      setPromptError("Pi Station could not deliver this message. Your draft was restored.");
      const failedIdentity = submittedSessionIdentity.current
      setOptimisticPrompt((current) => {
        if (
          current?.requestId === submittedRequestId
          && failedIdentity === selectedSessionIdentity
        ) {
          writeComposerDraft(selectedSessionIdentity, current.text)
          setDraft(current.text)
        }
        return undefined
      })
      setQueuedInputs((current) => {
        const failed = current.find((item) => item.requestId === submittedRequestId)
        if (failed !== undefined && failedIdentity === selectedSessionIdentity) {
          writeComposerDraft(selectedSessionIdentity, failed.text)
          setDraft(failed.text)
        }
        return current.filter((item) => item.requestId !== submittedRequestId)
      })
      submittedSessionIdentity.current = undefined
      setSubmittedRequestId(undefined)
      return
    }
    if (submitted.result === undefined) return
    if (submitted.result.outcome.status === "succeeded") {
      setQueuedInputs((current) => current.map((item) => (
        item.requestId === submittedRequestId
          ? { ...item, status: "queued" }
          : item
      )))
      const submittedIdentity = submittedSessionIdentity.current
      writeComposerDraft(submittedIdentity, "")
      if (submittedIdentity === selectedSessionIdentity) setDraft("")
      submittedSessionIdentity.current = undefined
      for (const image of images) {
        image.controller.abort()
        URL.revokeObjectURL(image.previewUrl)
      }
      setImages([])
      for (const file of files) file.controller.abort()
      setFiles([])
      setSubmittedRequestId(undefined)
    } else {
      setOptimisticPrompt(undefined)
      setQueuedInputs((current) => current.filter(
        (item) => item.requestId !== submittedRequestId,
      ))
    }
  }, [selectedSessionIdentity, submitted, submittedRequestId]);

  const clearQueueRequest = clearQueueRequestId === undefined
    ? undefined
    : state.commands?.[clearQueueRequestId]
  const clearQueuePending = clearQueueRequest?.status === "queued" || clearQueueRequest?.status === "accepted"

  useEffect(() => {
    if (clearQueueRequestId === undefined || clearQueueRequest === undefined) return
    if (clearQueueRequest.status === "completed") {
      const canceledMessages = queuedInputs.map((item) => item.text).join("\n\n")
      const restoredDraft = [canceledMessages, draft].filter((value) => value.length > 0).join("\n\n")
      writeComposerDraft(selectedSessionIdentity, restoredDraft)
      setDraft(restoredDraft)
      setQueuedInputs([])
      setClearQueueRequestId(undefined)
    } else if (clearQueueRequest.status === "not-accepted") {
      setPromptError("Pi Station could not cancel the queued messages.")
      setClearQueueRequestId(undefined)
    }
  }, [clearQueueRequest, clearQueueRequestId, draft, queuedInputs, selectedSessionIdentity])

  useEffect(() => {
    setPendingAgentActivity(undefined)
  }, [
    state.selectedSessionKey?.hostId,
    state.selectedSessionKey?.piSessionId,
  ])

  useEffect(() => {
    if (optimisticPrompt === undefined) return
    const matches = state.selected.timeline.filter((item) => (
      item.category === "user-message"
      && item.content.text === optimisticPrompt.text
    )).length
    if (matches > optimisticPrompt.baselineMatches) setOptimisticPrompt(undefined)
  }, [optimisticPrompt, state.selected.timeline]);

  useEffect(() => {
    setQueuedInputs((current) => current.filter((pending) => {
      const matches = state.selected.timeline.filter((item) => (
        item.category === "user-message"
        && item.content.text === pending.text
      )).length
      return matches <= pending.baselineMatches
    }))
  }, [state.selected.timeline]);

  useEffect(() => {
    if (!voiceMode || !voiceAutoplay || !awaitingVoiceResponse.current || working || voiceState !== "idle") return;
    const response = [...state.selected.timeline].reverse().find((item) => item.category === "assistant-response");
    if (response === undefined || response.timelineItemId === voiceResponseBaseline.current) return;
    if (voiceResponsesToSkip.current > 0) {
      voiceResponseBaseline.current = response.timelineItemId;
      voiceResponsesToSkip.current -= 1;
      return;
    }
    voiceResponseBaseline.current = response.timelineItemId;
    awaitingVoiceResponse.current = false;
    void playSpeech(response.content.text, response.timelineItemId);
  }, [state.selected.timeline, voiceAutoplay, voiceMode, voiceState, working]);

  const releaseVoiceRecorder = (): void => {
    window.clearTimeout(voiceLimitTimer.current);
    voiceLimitTimer.current = undefined;
    voiceStream.current?.getTracks().forEach((track) => track.stop());
    voiceStream.current = undefined;
    voiceRecorder.current = undefined;
  };

  const stopVoiceRecording = (transcribe: boolean): void => {
    const recorder = voiceRecorder.current;
    if (recorder === undefined) return;
    voiceKeepRecording.current = transcribe;
    window.clearTimeout(voiceLimitTimer.current);
    if (recorder.state !== "inactive") recorder.stop();
  };

  const startVoiceRecording = async (direct = false): Promise<void> => {
    if (voiceState !== "idle" || !voiceConfiguration.configured || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
    setVoiceError(undefined);
    try {
      const input = composerInput.current;
      voiceSelection.current = {
        start: input?.selectionStart ?? draft.length,
        end: input?.selectionEnd ?? draft.length,
        identity: selectedSessionIdentity,
        direct,
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });
      voiceStream.current = stream;
      voiceRecorder.current = recorder;
      voiceChunks.current = [];
      voiceKeepRecording.current = false;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) voiceChunks.current.push(event.data); });
      recorder.addEventListener("stop", () => {
        const shouldTranscribe = voiceKeepRecording.current;
        const type = recorder.mimeType || voiceChunks.current[0]?.type || "audio/webm";
        const audio = new Blob(voiceChunks.current, { type });
        voiceChunks.current = [];
        releaseVoiceRecorder();
        if (!shouldTranscribe) { setVoiceState("idle"); setVoiceError("Recording cancelled."); return; }
        if (audio.size === 0) { setVoiceState("idle"); setVoiceError("Nothing was recorded."); return; }
        setVoiceState("transcribing");
        void fetch("/v2/voice/transcriptions", { method: "POST", headers: { "Content-Type": type }, body: audio })
          .then(async (response) => {
            const body = await response.json() as { text?: string };
            if (!response.ok || body.text === undefined) throw new Error("Transcription failed");
            if (voiceSelection.current.identity !== selectedSessionIdentityRef.current) throw new Error("The selected Session changed. Record the message again.");
            const selection = voiceSelection.current;
            if (selection.direct) {
              const text = body.text.trim();
              const directDelivery = working ? workingDelivery : "prompt.send";
              const requestId = onCommand?.({ kind: directDelivery, text });
              if (requestId === undefined) throw new Error("Pi Station could not send the voice message.");
              voiceResponseBaseline.current = [...state.selected.timeline].reverse().find((item) => item.category === "assistant-response")?.timelineItemId;
              awaitingVoiceResponse.current = true;
              voiceResponsesToSkip.current = working && directDelivery === "prompt.follow-up" ? 1 : 0;
              setVoiceError(undefined);
              return;
            }
            setDraft((current) => {
              const before = current.slice(0, selection.start);
              const after = current.slice(selection.end);
              const prefix = before.length > 0 && !/\s$/u.test(before) ? " " : "";
              const suffix = after.length > 0 && !/^\s/u.test(after) ? " " : "";
              const next = `${before}${prefix}${body.text}${suffix}${after}`;
              writeComposerDraft(selectedSessionIdentityRef.current, next);
              return next;
            });
            requestAnimationFrame(() => composerInput.current?.focus());
          })
          .catch((error: unknown) => setVoiceError(error instanceof Error ? error.message : "Pi Station could not transcribe the recording."))
          .finally(() => setVoiceState("idle"));
      }, { once: true });
      recorder.start(250);
      setVoiceState("recording");
      voiceLimitTimer.current = window.setTimeout(() => stopVoiceRecording(true), voiceConfiguration.maximumSeconds * 1000);
    } catch (error: unknown) {
      releaseVoiceRecorder();
      setVoiceState("idle");
      setVoiceError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access was not allowed."
        : "Pi Station could not open the microphone.");
    }
  };

  const clearSpeechPlayback = (): void => {
    voiceAudio.current?.pause();
    voiceAudio.current = undefined;
    if (voiceAudioUrl.current !== undefined) URL.revokeObjectURL(voiceAudioUrl.current);
    voiceAudioUrl.current = undefined;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const stopSpeech = (): void => {
    speechOperation.current += 1;
    clearSpeechPlayback();
    setPlayingResponseId(undefined);
    setVoiceState("idle");
  };

  const playSpeech = async (text: string, responseId?: string): Promise<void> => {
    clearSpeechPlayback();
    const operation = speechOperation.current + 1;
    speechOperation.current = operation;
    setPlayingResponseId(responseId);
    setVoiceError(undefined);
    setVoiceState("playing");
    const finish = (): void => {
      if (speechOperation.current === operation) stopSpeech();
    };
    try {
      if (!voiceConfiguration.configured) throw new Error("use-browser-speech");
      const cacheKey = `${responseId ?? text}:${voiceConfiguration.speechModel}:${voiceConfiguration.speechVoice}`;
      let blob = speechCache.current.get(cacheKey);
      if (blob === undefined) {
        const response = await fetch("/v2/voice/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!response.ok) throw new Error("provider-unavailable");
        blob = await response.blob();
        speechCache.current.set(cacheKey, blob);
        if (speechCache.current.size > 20) {
          const oldestKey = speechCache.current.keys().next().value;
          if (oldestKey !== undefined) speechCache.current.delete(oldestKey);
        }
      } else {
        speechCache.current.delete(cacheKey);
        speechCache.current.set(cacheKey, blob);
      }
      if (speechOperation.current !== operation) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = voiceConfiguration.playbackSpeed;
      audio.preservesPitch = true;
      voiceAudio.current = audio;
      voiceAudioUrl.current = url;
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch {
      if (speechOperation.current !== operation) return;
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
        finish();
        setVoiceError("This browser does not support voice playback. Add an OpenAI API key in Voice Messages settings.");
        return;
      }
      clearSpeechPlayback();
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.rate = voiceConfiguration.playbackSpeed;
      utterance.onend = finish;
      utterance.onerror = () => {
        finish();
        setVoiceError("This browser could not play the response. Add an OpenAI API key in Voice Messages settings.");
      };
      window.speechSynthesis.resume();
      window.setTimeout(() => {
        if (speechOperation.current === operation) window.speechSynthesis.speak(utterance);
      }, 0);
    }
  };

  useEffect(() => {
    awaitingVoiceResponse.current = false;
    voiceResponsesToSkip.current = 0;
    voiceResponseBaseline.current = [...state.selected.timeline].reverse().find((item) => item.category === "assistant-response")?.timelineItemId;
    stopSpeech();
  }, [selectedSessionIdentity]);


  useEffect(() => {
    const toggleVoiceAudio = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!voiceMode && voiceState !== "playing") return;
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (target?.closest("button, input, select, textarea, a, [contenteditable='true']") !== null && target !== undefined) return;
      event.preventDefault();
      if (voiceState === "playing") stopSpeech();
      else if (voiceState === "recording") stopVoiceRecording(true);
      else if (voiceState === "idle" && commandAvailable && !commandPending) void startVoiceRecording(true);
    };
    window.addEventListener("keydown", toggleVoiceAudio);
    return () => window.removeEventListener("keydown", toggleVoiceAudio);
  }, [commandAvailable, commandPending, voiceMode, voiceState]);

  const projectNames = new Map(state.projects.map((project) => [project.projectId, project.name]));
  const agentMentionOptions: readonly AgentMentionOption[] = state.sessions
    .filter((session) => session.projection.availability === "available")
    .filter((session) => selectedSessionIdentity === undefined || sessionIdentity(session.sessionKey) !== selectedSessionIdentity)
    .map((session) => {
      const projectName = session.projectId === undefined ? undefined : projectNames.get(session.projectId);
      return {
        sessionId: session.sessionKey.piSessionId,
        sessionName: session.name?.trim() || "Untitled Session",
        ...(projectName === undefined ? {} : { projectName }),
      };
    })
    .sort((left, right) => {
      if (left.projectName === undefined) return right.projectName === undefined ? left.sessionName.localeCompare(right.sessionName) : 1;
      if (right.projectName === undefined) return -1;
      return left.projectName.localeCompare(right.projectName) || left.sessionName.localeCompare(right.sessionName);
    });
  const filteredAgentMentions = filterAgentMentions(agentMentionOptions, agentMention?.query ?? "");
  const slashCommands: readonly SlashCommandOption[] = state.selected.details?.commandInventory ?? [];
  const filteredSlashCommands = filterSlashCommands(slashCommands, slashCommandQuery ?? "");

  const selectSlashCommand = (option: SlashCommandOption): void => {
    const input = composerInput.current;
    const cursor = input?.selectionStart ?? draft.length;
    const suffix = draft.slice(cursor);
    const separator = suffix.length === 0 || !/^\s/u.test(suffix) ? " " : "";
    const command = `/${option.name}`;
    const next = `${command}${separator}${suffix}`;
    setDraft(next);
    writeComposerDraft(selectedSessionIdentity, next);
    setSlashCommandQuery(undefined);
    requestAnimationFrame(() => {
      const position = command.length + separator.length;
      input?.focus();
      input?.setSelectionRange(position, position);
    });
  };

  const selectAgentMention = (option: AgentMentionOption): void => {
    if (agentMention === undefined) return;
    const input = composerInput.current;
    const cursor = input?.selectionStart ?? draft.length;
    const label = agentMentionLabel(option);
    const token = `@${label}`;
    const suffix = draft.slice(cursor);
    const separator = suffix.length === 0 || !/^\s/u.test(suffix) ? " " : "";
    const next = `${draft.slice(0, agentMention.start)}${token}${separator}${suffix}`;
    setDraft(next);
    writeComposerDraft(selectedSessionIdentity, next);
    setSelectedAgentMentions((current) => [
      ...current.filter((mention) => mention.token !== token),
      { sessionId: option.sessionId, label, token },
    ]);
    setAgentMention(undefined);
    requestAnimationFrame(() => {
      const position = agentMention.start + token.length + separator.length;
      input?.focus();
      input?.setSelectionRange(position, position);
    });
  };

  const submitPrompt = (): void => {
    const text = draft.trim();
    const imageIds = images.flatMap((image) => image.status === "ready" && image.uploadId !== undefined ? [image.uploadId] : []);
    const attachmentIds = files.flatMap((file) => file.status === "ready" && file.uploadId !== undefined ? [file.uploadId] : []);
    if (!commandAvailable || commandPending || images.some((image) => image.status !== "ready") || files.some((file) => file.status !== "ready") || (text.length === 0 && imageIds.length + attachmentIds.length === 0)) return;
    setPromptError(undefined);
    const rememberedMentions = selectedAgentMentions.filter((mention) => text.includes(mention.token));
    const rememberedTokens = new Set(rememberedMentions.map((mention) => mention.token));
    const restoredMentions = agentMentionOptions.flatMap((option) => {
      const label = agentMentionLabel(option);
      const token = `@${label}`;
      const uniqueLabel = agentMentionOptions.filter((candidate) => agentMentionLabel(candidate) === label).length === 1;
      return uniqueLabel && text.includes(token) && !rememberedTokens.has(token)
        ? [{ sessionId: option.sessionId, label }]
        : [];
    });
    const agentMentions = [
      ...rememberedMentions.map(({ sessionId, label }) => ({ sessionId, label })),
      ...restoredMentions,
    ];
    const requestId = onCommand?.({ kind: delivery, text, ...(imageIds.length === 0 ? {} : { imageIds }), ...(attachmentIds.length === 0 ? {} : { attachmentIds }), ...(agentMentions.length === 0 ? {} : { agentMentions }) });
    if (requestId !== undefined) {
      submittedSessionIdentity.current = selectedSessionIdentity;
      setSubmittedRequestId(requestId);
      writeComposerDraft(selectedSessionIdentity, "");
      setDraft("");
      setAgentMention(undefined);
      setSelectedAgentMentions([]);
      if (delivery === "prompt.steer" || delivery === "prompt.follow-up") {
        const baselineMatches = state.selected.timeline.filter((item) => (
          item.category === "user-message" && item.content.text === text
        )).length;
        setQueuedInputs((current) => [
          ...current,
          { requestId, text, delivery, baselineMatches, status: "submitting" },
        ]);
      } else {
        const baselineMatches = state.selected.timeline.filter((item) => (
          item.category === "user-message" && item.content.text === text
        )).length;
        setOptimisticPrompt({ requestId, text, baselineMatches });
        setPendingAgentActivity({
          baselineTimelineItems: state.selected.timeline.length,
        });
      }
    }
  };

  const abort = (): void => {
    if (!synchronized || !capabilities.includes("session.abort")) return;
    onCommand?.({ kind: "session.abort" });
  };

  useLayoutEffect(() => {
    if (
      route !== "workspace"
      || !followsLatest.current
      || historyScrollAnchor.current !== undefined
    ) return;
    const frame = requestAnimationFrame(() => {
      const bottom = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
      document.body.scrollTop = bottom;
      document.documentElement.scrollTop = bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    route,
    state.selectedSessionKey?.hostId,
    state.selectedSessionKey?.piSessionId,
    state.selected.timeline,
    optimisticPrompt,
  ]);

  const initialConnection = state.connection !== "ready"
    && state.sessions.length === 0
    && state.selectedSessionKey === undefined;
  if (initialConnection) return <InitialConnectionScreen state={state} />;

  const contextMenu = sessionContextMenu === undefined ? null : (
    <SessionContextMenu
      session={sessionContextMenu.session}
      x={sessionContextMenu.x}
      y={sessionContextMenu.y}
      bookmarked={state.sessionBookmarks.some((bookmark) => sessionKeysEqual(
        bookmark.sessionKey,
        sessionContextMenu.session.sessionKey,
      ))}
      onClose={() => setSessionContextMenu(undefined)}
      onRename={() => {
        setRenameSession(sessionContextMenu.session);
        setRenameSessionName(sessionLabel(sessionContextMenu.session));
        setRouteState("workspace");
      }}
      onBookmark={() => {
        const target = sessionContextMenu.session;
        if (target.projectId === undefined) return;
        const bookmarked = state.sessionBookmarks.some((bookmark) => (
          bookmark.projectId === target.projectId
          && sessionKeysEqual(bookmark.sessionKey, target.sessionKey)
        ));
        onSetSessionBookmark?.(target.projectId, target.sessionKey, !bookmarked);
      }}
      onClone={() => {
        const target = sessionContextMenu.session;
        const requestId = onCommand?.({ kind: "session.clone" }, target.sessionKey);
        if (requestId === undefined) return;
        const project = target.projectId === undefined
          ? undefined
          : state.projects.find(({ projectId }) => projectId === target.projectId);
        const originalName = target.name ?? "Untitled Session";
        cloneSource.current = {
          source: target.sessionKey,
          workingDirectory: target.displayPath ?? project?.displayPath ?? "",
          cloneName: `${[...originalName].slice(0, 114).join("")}-clone`,
        };
        setCloneSessionRequestId(requestId);
      }}
      onReload={() => {
        const requestId = onCommand?.(
          { kind: "session.reload" },
          sessionContextMenu.session.sessionKey,
        );
        if (requestId !== undefined) setReloadSessionRequestId(requestId);
      }}
      onRequestClose={() => {
        setCloseSessionRequestId(undefined);
        setCloseSessionTarget(sessionContextMenu.session);
        setCloseSessionConfirmOpen(true);
        setRouteState("workspace");
      }}
    />
  );
  const sidebar = (
    <Sidebar
      state={state}
      onQuickSession={onOpenQuickSession}
      onOpenSessionInWorkspace={(session) => afterSharedMarkdownCheck(() => openSession(session.sessionKey))}
      onActivitySelect={(session) => afterSharedMarkdownCheck(() => {
        void openActivitySession(session).catch((reason: unknown) => toast({
          message: reason instanceof Error ? reason.message : "Activity Session could not be opened.",
          variant: "error",
        }));
      })}
      onSelectWorkspaceTab={(tab, session) => afterSharedMarkdownCheck(() => {
        if (client === undefined || activeWorkspace === undefined) { openSession(session.sessionKey); return; }
        void client.selectWorkspaceTab(activeWorkspace.id, tab.id)
          .then(() => openSession(session.sessionKey, false))
          .catch((reason: unknown) => toast({ message: reason instanceof Error ? reason.message : "Workspace tab could not be selected.", variant: "error" }));
      })}
      onAddDirectoryAsProject={(directory) => afterSharedMarkdownCheck(() => { setAddProjectInitialDirectory(directory); setRoute("add-project"); })}
      onCloseWorkspaceTab={(tab) => afterSharedMarkdownCheck(() => {
        const workspaceClient = client;
        if (workspaceClient === undefined || activeWorkspace === undefined) return;
        void workspaceClient.closeWorkspaceTab(activeWorkspace.id, tab.id).catch((reason: unknown) => toast({
          message: reason instanceof Error ? reason.message : "Workspace tab could not be removed.",
          variant: "error",
        }));
      })}
      onCloseProjectTabs={(project) => afterSharedMarkdownCheck(() => {
        if (client === undefined || activeWorkspace === undefined) return;
        void client.closeProjectTabs(activeWorkspace.id, project.projectId).catch((reason: unknown) => toast({
          message: reason instanceof Error ? reason.message : "Project tabs could not be closed.",
          variant: "error",
        }));
      })}
      onDashboard={() => setRoute("dashboard")}
      onGeneralNewSession={() => setRoute("new-session")}
      onProjects={() => { setAddProjectInitialDirectory(undefined); setRoute("projects"); }}
      onSettings={() => setRoute("settings")}
      onOpenProject={(projectId) => {
        setSelectedProjectId(projectId);
        setRoute("project");
      }}
      onSessionContextMenu={(session, x, y) => setSessionContextMenu({
        session,
        x: Math.max(8, Math.min(x, window.innerWidth - 220)),
        y: Math.max(8, Math.min(y, window.innerHeight - 250)),
      })}
      activeRoute={route}
      shortcutsVisible={sessionShortcutsVisible}
      onCollapse={() => setSidebarVisible(false)}
      {...(selectedProjectId === undefined ? {} : { activeProjectId: selectedProjectId })}
      onNewSession={(project) => afterSharedMarkdownCheck(() => {
        setNewSessionName("");
        setNewSessionRequestId(undefined);
        setNewSessionProject(project);
        setRouteState("workspace");
      })}
    />
  );
  const activeSidebarWidth = sidebarVisible ? sidebarWidth : 0;
  const requireWorkspaceClient = (): ApplicationClient => {
    if (client === undefined) throw new Error("Workspace changes are unavailable");
    return client;
  };
  const workspaceRow = !embeddedSession && (
    <WorkspaceRow
      workspaces={applicationState.workspaces ?? []}
      activeWorkspaceId={applicationState.activeWorkspaceId}
      sessions={sessionsVisibleInWorkspace(applicationState.sessions)}
      onActivate={(id) => id === state.activeWorkspaceId && route === "workspace" ? Promise.resolve() : guardedWorkspaceAction(() => activateWorkspace(id))}
      onCreate={(name) => guardedWorkspaceAction(async () => {
        const workspaceClient = requireWorkspaceClient();
        const createdId = await workspaceClient.createWorkspace(name);
        await activateWorkspace(createdId);
      })}
      onRename={(id, name) => guardedWorkspaceAction(() => requireWorkspaceClient().renameWorkspace(id, name))}
      onClose={(id) => guardedWorkspaceAction(() => requireWorkspaceClient().closeWorkspace(id))}
      onRestore={(id) => guardedWorkspaceAction(async () => {
        await requireWorkspaceClient().restoreWorkspace(id);
        await activateWorkspace(id);
      })}
      onDelete={(id) => guardedWorkspaceAction(() => requireWorkspaceClient().deleteWorkspace(id))}
    />
  );
  const closeMobileWorkspaceNavigation = (): void => { mobileWorkspaceNavigationRef.current?.removeAttribute("open"); };
  const mobileWorkspaceNavigation = !embeddedSession && activeWorkspace !== undefined && (
    <details ref={mobileWorkspaceNavigationRef} className="mobile-workspace-navigation">
      <summary>Sessions</summary>
      <div className="mobile-workspace-navigation-panel">
        <AgentAttention sessions={state.sessions} projects={state.projects} selectedSessionKey={state.selectedSessionKey} onSelect={(key) => {
          const session = state.sessions.find((candidate) => sessionKeysEqual(candidate.sessionKey, key));
          if (session === undefined) return;
          afterSharedMarkdownCheck(() => {
            void openActivitySession(session).then(closeMobileWorkspaceNavigation).catch((reason: unknown) => toast({
              message: reason instanceof Error ? reason.message : "Activity Session could not be opened.", variant: "error",
            }));
          });
        }} />
        <WorkspaceNavigation
          workspace={activeWorkspace}
          projects={state.projects}
          sessions={sessionsVisibleInWorkspace(state.sessions)}
          selectedSessionKey={state.selectedSessionKey}
          onNewSession={() => setRoute("new-session")}
          onNewSessionInProject={(project) => afterSharedMarkdownCheck(() => {
            setNewSessionName("");
            setNewSessionRequestId(undefined);
            setNewSessionProject(project);
            setRouteState("workspace");
            closeMobileWorkspaceNavigation();
          })}
          onOpenSession={(session) => afterSharedMarkdownCheck(() => {
            openSession(session.sessionKey);
            closeMobileWorkspaceNavigation();
          })}
          onSelectTab={(tab, session) => afterSharedMarkdownCheck(() => {
            if (client === undefined) { openSession(session.sessionKey); return; }
            void client.selectWorkspaceTab(activeWorkspace.id, tab.id)
              .then(() => {
                openSession(session.sessionKey, false);
                closeMobileWorkspaceNavigation();
              })
              .catch((reason: unknown) => toast({ message: reason instanceof Error ? reason.message : "Workspace tab could not be selected.", variant: "error" }));
          })}
          onCloseTab={(tab) => afterSharedMarkdownCheck(() => {
            void client?.closeWorkspaceTab(activeWorkspace.id, tab.id).catch((reason: unknown) => toast({
              message: reason instanceof Error ? reason.message : "Workspace tab could not be removed.",
              variant: "error",
            }));
          })}
          onAddDirectoryAsProject={(directory) => afterSharedMarkdownCheck(() => { setAddProjectInitialDirectory(directory); setRoute("add-project"); closeMobileWorkspaceNavigation(); })}
          onCloseProjectTabs={(project) => afterSharedMarkdownCheck(() => {
            void client?.closeProjectTabs(activeWorkspace.id, project.projectId).catch((reason: unknown) => toast({
              message: reason instanceof Error ? reason.message : "Project tabs could not be closed.",
              variant: "error",
            }));
          })}
        />
      </div>
    </details>
  );
  const resizeSidebarWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next = sidebarWidth;
    if (event.key === "ArrowLeft") next -= 10;
    else if (event.key === "ArrowRight") next += 10;
    else if (event.key === "Home") next = 280;
    else if (event.key === "End") next = 500;
    else return;
    event.preventDefault();
    setSidebarWidth(Math.min(500, Math.max(280, next)));
  };
  const newSessionModal = (
<Modal
        open={newSessionProject !== undefined}
        title={`New Session in ${newSessionProject?.name ?? "Project"}`}
        initialFocus={newSessionNameInput}
        busy={newSessionPending}
        onClose={() => setNewSessionProject(undefined)}
        onSubmit={(event) => {
          event.preventDefault();
          if (newSessionProject === undefined || newSessionPending) return;
          const trimmedName = newSessionName.trim();
          const requestId = onCreateManagedSession?.(
            newSessionProject.displayPath,
            trimmedName === "" ? undefined : trimmedName,
          );
          if (requestId !== undefined) setNewSessionRequestId(requestId);
        }}
        actions={(
          <>
            <button
              type="button"
              className="modal-button secondary"
              onClick={() => setNewSessionProject(undefined)}
              disabled={newSessionPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-button primary"
              disabled={
                newSessionPending
                || !state.hostCapabilities.some(
                  (capability) => capability === "managed-session.create",
                )
              }
              title={state.hostCapabilities.some(
                (capability) => capability === "managed-session.create",
              )
                ? undefined
                : "Managed Session creation is not available"}
            >
              {newSessionPending ? "Starting…" : "Start Pi"}
            </button>
          </>
        )}
      >
        <label className="modal-field">
          <span>
            Session name <small>(optional)</small>
          </span>
          <input
            ref={newSessionNameInput}
            value={newSessionName}
            onChange={(event) => setNewSessionName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder="e.g. Release planning"
          />
        </label>
        {newSessionError && (
          <p className="modal-error" role="alert">{newSessionError}</p>
        )}
      </Modal>
  );
  const renderPage = (page: ReactNode): ReactNode => (
    <>
      <div className="workspace-application">
      {workspaceRow}
      {mobileWorkspaceNavigation}
      <main
        className={`workspace${sidebarVisible ? "" : " sidebar-hidden"}`}
        style={{ "--rail": `${activeSidebarWidth}px` } as CSSProperties}
      >
        {sidebarVisible && sidebar}
        {sidebarVisible && (
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={280}
            aria-valuemax={500}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setResizingSidebar(true);
            }}
            onKeyDown={resizeSidebarWithKeyboard}
          />
        )}
        {!sidebarVisible && (
          <button
            className="sidebar-expand-control"
            type="button"
            aria-label="Show sidebar"
            aria-keyshortcuts="Control+B Meta+B"
            onClick={() => setSidebarVisible(true)}
          >
            <PanelLeftOpen aria-hidden="true" size={18} />
          </button>
        )}
        <div className="workspace-page">
          <Suspense fallback={<p className="page-loading" role="status">Loading…</p>}>
            {page}
          </Suspense>
        </div>
      </main>
      </div>
      {contextMenu}
      {newSessionModal}
    </>
  );

  if (route === "dashboard") {
    return renderPage(
      <Dashboard
        state={state}
        onOpen={(key) => afterSharedMarkdownCheck(() => openSession(key))}
        onOpenProject={(projectId) => {
          setSelectedProjectId(projectId);
          setRoute("project");
        }}
        onNewSession={() => setRoute("new-session")}
        onOpenQuickSession={() => onOpenQuickSession?.()}
        onNewProjectSession={(project) => {
          setNewSessionName("");
          setNewSessionRequestId(undefined);
          setNewSessionProject(project);
        }}
        onAddProject={() => setRoute("add-project")}
        onDashboard={() => setRoute("dashboard")}
        onProjects={() => setRoute("projects")}
        onSettings={() => setRoute("settings")}
      />,
    );
  }

  if (route === "settings") {
    return renderPage(
      <SettingsPage
        onBack={() => setRoute("workspace")}
        onOpen={setRoute}
      />,
    );
  }

  if (route === "notifications") {
    return renderPage(
      <NotificationSettingsPage onBack={() => setRoute("settings")} />,
    );
  }

  if (route === "themes") {
    return renderPage(
      <ThemeSettingsPage onBack={() => setRoute("settings")} />,
    );
  }

  if (route === "session-defaults") {
    return renderPage(
      <SessionDefaultsPage onBack={() => setRoute("settings")} />,
    );
  }
  if (route === "providers" && client !== undefined) return renderPage(<ProviderAuthPage client={client} onBack={() => setRoute("settings")} />);
  if (route === "timezone") return renderPage(<TimezoneSettingsPage client={client} onBack={() => setRoute("settings")} />);
  if (route === "editor") return renderPage(<EditorSettingsPage onBack={() => setRoute("settings")} />);
  if (route === "update" && client !== undefined) return renderPage(<UpdateSettingsPage client={client} onBack={() => setRoute("settings")} />);
  if (route === "voice-messages") {
    return renderPage(
      <VoiceSettingsPage onBack={() => setRoute("settings")} />,
    );
  }

  if (route === "projects") {
    return renderPage(
      <ProjectsPage
        state={applicationState}
        onOpen={(projectId) => {
          setSelectedProjectId(projectId);
          setRoute("project");
        }}
        onAdd={() => setRoute("add-project")}
        onNewSession={(project) => afterSharedMarkdownCheck(() => {
          if (project === undefined) setRoute("new-session");
          else {
            setNewSessionProject(project);
            setRoute("workspace");
          }
        })}
        onDashboard={() => setRoute("dashboard")}
        onProjects={() => setRoute("projects")}
        onSettings={() => setRoute("settings")}
        onReorderBookmark={(projectId, direction) => (
          onReorderProjectBookmark?.(projectId, direction) ?? undefined
        )}
        onSetProjectClosed={(projectId, closed) => onSetProjectClosed?.(projectId, closed) ?? Promise.reject(new Error("Project state changes are unavailable"))}
      />,
    );
  }

  if (route === "project") {
    const project = applicationState.projects.find(
      (candidate) => candidate.projectId === selectedProjectId,
    );
    if (project !== undefined) {
      return renderPage(
        <ProjectPage
          state={state}
          client={client}
          project={project}
          onBack={() => setRoute("projects")}
          onNewSession={() => {
            setNewSessionProject(project);
            setRoute("workspace");
          }}
          onOpenSession={(key) => afterSharedMarkdownCheck(() => openSession(key))}
          onSetProjectBookmark={(bookmarked) => (
            onSetProjectBookmark?.(project.projectId, bookmarked) ?? undefined
          )}
          onRemoveProject={() => onRemoveProject?.(project.projectId)}
          onSetProjectClosed={(closed) => onSetProjectClosed?.(project.projectId, closed) ?? Promise.reject(new Error("Project state changes are unavailable"))}
          onRemoved={() => {
            setSelectedProjectId(undefined);
            setRouteState("projects");
          }}
          onSetSessionBookmark={(sessionKey, bookmarked) => (
            onSetSessionBookmark?.(project.projectId, sessionKey, bookmarked)
              ?? undefined
          )}
          onReorderSessionBookmark={(sessionKey, direction) => (
            onReorderSessionBookmark?.(project.projectId, sessionKey, direction)
              ?? undefined
          )}
          onCloseSessions={(sessionKeys) => {
            for (const sessionKey of sessionKeys) {
              onCommand?.({ kind: "session.close" }, sessionKey);
            }
          }}
          {...(state.developmentServers.find((server) => server.projectId === project.projectId) === undefined
            ? {}
            : { developmentServer: state.developmentServers.find((server) => server.projectId === project.projectId)! })}
          onConfigureDevelopmentServer={(configuration) => (
            onConfigureDevelopmentServer?.(project.projectId, configuration) ?? undefined
          )}
        />,
      );
    }
    return renderPage(
      <ProjectsPage
        state={applicationState}
        onOpen={(projectId) => {
          setSelectedProjectId(projectId);
          setRoute("project");
        }}
        onAdd={() => setRoute("add-project")}
        onNewSession={(project) => afterSharedMarkdownCheck(() => {
          if (project === undefined) setRoute("new-session");
          else {
            setNewSessionProject(project);
            setRoute("workspace");
          }
        })}
        onDashboard={() => setRoute("dashboard")}
        onProjects={() => setRoute("projects")}
        onSettings={() => setRoute("settings")}
        onReorderBookmark={(projectId, direction) => (
          onReorderProjectBookmark?.(projectId, direction) ?? undefined
        )}
        onSetProjectClosed={(projectId, closed) => onSetProjectClosed?.(projectId, closed) ?? Promise.reject(new Error("Project state changes are unavailable"))}
      />,
    );
  }

  if (route === "add-project") {
    return renderPage(
      <AddProjectPage
        state={state}
        onBack={() => setRoute("projects")}
        onListDirectory={(path, showHidden) => (
          onListDirectory?.(path, showHidden) ?? undefined
        )}
        onCreate={(name, directory) => (
          onCreateProject?.(name, directory) ?? undefined
        )}
        {...(addProjectInitialDirectory === undefined ? {} : { initialDirectory: addProjectInitialDirectory })}
        onCreated={(projectId) => {
          setAddProjectInitialDirectory(undefined);
          setSelectedProjectId(projectId);
          setRoute("project");
        }}
      />,
    );
  }

  if (route === "new-session" || route === "new-directory-session") {
    return renderPage(
      <NewSessionPage
        state={state}
        onBack={() => setRoute("workspace")}
        onListDirectory={(path, showHidden) => (
          onListDirectory?.(path, showHidden) ?? undefined
        )}
        onCreate={(workingDirectory, optionalName) => (
          onCreateManagedSession?.(workingDirectory, optionalName) ?? undefined
        )}
        onStarted={(sessionKey) => {
          focusComposerForSession.current = isDesktopViewport() ? sessionKey : undefined;
          openSession(sessionKey);
        }}
        directoryOnly={route === "new-directory-session"}
      />,
    );
  }

  if (!embeddedSession && activeWorkspace !== undefined && activeWorkspace.tabs.length === 0) {
    const savedSessions = state.sessions.filter(({ quickSession, parentSessionKey }) => quickSession !== true && parentSessionKey === undefined);
    return renderPage(
      <main className="workspace-empty" aria-labelledby="workspace-empty-title">
        <div className="workspace-empty-card">
          <h1 id="workspace-empty-title">{activeWorkspace.name} is empty</h1>
          <p>Start new work or open a previous Session in this Workspace.</p>
          <Button type="button" onClick={() => setRoute("new-session")}><Plus aria-hidden="true" />New Session</Button>
          <section aria-labelledby="workspace-saved-sessions-title">
            <h2 id="workspace-saved-sessions-title">Open existing Session</h2>
            {savedSessions.length === 0 ? <p>No previous Sessions are available.</p> : <div className="workspace-empty-sessions">
              {savedSessions.map((session) => <button type="button" key={sessionIdentity(session.sessionKey)} onClick={() => afterSharedMarkdownCheck(() => openSession(session.sessionKey))}>
                <strong>{sessionLabel(session)}</strong>
                <span>{state.projects.find(({ projectId }) => projectId === session.projectId)?.name ?? "Unknown Project"}</span>
              </button>)}
            </div>}
          </section>
        </div>
      </main>,
    );
  }

  const hiddenTimelineItems = Math.max(
    0,
    state.selected.timeline.length - visibleTimelineItems,
  );
  const visibleTimeline = state.selected.timeline.slice(hiddenTimelineItems);
  const agentActivityPresent = pendingAgentActivity !== undefined
    && state.selected.timeline.slice(pendingAgentActivity.baselineTimelineItems).some((item) => (
      item.category === "assistant-response"
      || item.category === "tool-activity"
      || (item.category === "thinking" && !isThinkingPlaceholder(item.content.text))
    ));
  const showThinkingPlaceholder = pendingAgentActivity !== undefined
    && working
    && !agentActivityPresent;
  const canLoadEarlier = hiddenTimelineItems > 0
    || state.selected.hasEarlierHistory;
  const loadEarlier = (): void => {
    followsLatest.current = false;
    const anchor = {
      height: document.body.scrollHeight,
      y: window.scrollY,
    };
    if (hiddenTimelineItems > 0) {
      historyScrollAnchor.current = anchor;
      setVisibleTimelineItems((current) => Math.min(
        state.selected.timeline.length,
        current + 100,
      ));
      requestAnimationFrame(() => {
        window.scrollTo({
          top: anchor.y + document.body.scrollHeight - anchor.height,
          behavior: "auto",
        });
        historyScrollAnchor.current = undefined;
      });
      return;
    }
    if (onLoadEarlier?.()) historyScrollAnchor.current = anchor;
  };

  const composerFeedback = sessionSettingError ?? (sessionSettingPending ? "Applying Session setting…" : undefined) ?? voiceError ?? promptError ?? attachmentError;

  return (
    <>
    <Sheet open={detailsOpen} onOpenChange={(open) => {
      setDetailsOpen(open);
      if (!open) queueMicrotask(() => detailsTriggerRef.current?.focus());
    }}>
    <div className={`workspace-application${embeddedSession ? " embedded-session" : ""}`}>
    {workspaceRow}
    {mobileWorkspaceNavigation}
    <main
      className={`workspace${embeddedSession ? " embedded-session" : ""}${detailsOpen ? " details-open" : ""}${sharedMarkdownFile !== undefined ? " editor-open" : ""}${sidebarVisible && !embeddedSession ? "" : " sidebar-hidden"}`}
      style={{ "--rail": `${embeddedSession ? 0 : activeSidebarWidth}px` } as CSSProperties}
    >
      {sidebarVisible && !embeddedSession && sidebar}
      {sidebarVisible && !embeddedSession && (
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={500}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            setResizingSidebar(true);
          }}
          onKeyDown={resizeSidebarWithKeyboard}
        />
      )}
      {!sidebarVisible && !embeddedSession && (
        <button
          className="sidebar-expand-control"
          type="button"
          aria-label="Show sidebar"
          aria-keyshortcuts="Control+B Meta+B"
          onClick={() => setSidebarVisible(true)}
        >
          <PanelLeftOpen aria-hidden="true" size={18} />
        </button>
      )}
      <section ref={sessionContainer} className="session" aria-label="Selected Session">
        {!embeddedSession && <header className="session-header">
          <button
            className="mobile-back"
            onClick={() => setRoute("dashboard")}
            aria-label="Back to Dashboard"
          >
            <ArrowLeft aria-hidden="true" size={19} />
          </button>
          <div className="session-heading">
            <span className="session-heading-copy">
              {!embeddedSession && <span className="session-title">
                <i className={working ? "working" : ""} />
                <span className="session-title-text">
                  {state.selected.details?.name ??
                    selectedSummary?.name ??
                    "Session"}
                </span>
              </span>}
              <small>
                {!embeddedSession && <>
                  {selectedProject?.name ??
                    state.selected.details?.currentDirectoryDisplay ??
                    selectedSummary?.displayPath ??
                    "Synchronizing"}
                  {" · "}
                </>}
                {state.selected.details?.model?.modelId ?? "gpt-5.6-sol"}
                {" · "}
                {state.selected.details?.thinkingLevel ?? "Medium"}
              </small>
            </span>
          </div>
          <div className="session-header-actions">
            {selectedDevelopmentServer?.configuration !== undefined && (
              selectedDevelopmentServer.lifecycle === "running"
                ? selectedDevelopmentServer.previewUrl !== undefined
                  ? <a className="development-server-header-control" href={selectedDevelopmentServer.previewUrl} target="_blank" rel="noreferrer">Open preview</a>
                  : <button className="development-server-header-control" type="button" disabled>Server running</button>
                : selectedDevelopmentServer.lifecycle === "starting" || selectedDevelopmentServer.lifecycle === "stopping"
                  ? <button className="development-server-header-control" type="button" disabled>{selectedDevelopmentServer.lifecycle === "starting" ? "Starting…" : "Stopping…"}</button>
                  : <button className="development-server-header-control" type="button" disabled={developmentServerPending} onClick={() => {
                      const requestId = onStartDevelopmentServer?.(selectedDevelopmentServer.projectId);
                      if (requestId !== undefined) setDevelopmentServerRequestId(requestId);
                    }}>Start server</button>
            )}
            {selectedSummary?.quickSession !== true && <SheetTrigger render={<Button ref={detailsTriggerRef} className="session-details-trigger size-10 rounded-md" variant="outline" size="icon" aria-label="Session details" />}>
              <Ellipsis aria-hidden="true" size={20} />
            </SheetTrigger>}
          </div>
        </header>}

        <ConnectionNotice state={state} />

        {working && (
          <div className="working-strip" role="status">
            <div className="working-strip-content">
              <span>
                <i />
                Pi is working
              </span>
              <button
                type="button"
                onClick={abort}
                disabled={!synchronized || !capabilities.includes("session.abort")}
              >
                Abort
              </button>
            </div>
          </div>
        )}

        <section className="feed" aria-label="Conversation" aria-live="polite">
          {canLoadEarlier && (
            <button
              className="load-earlier"
              type="button"
              disabled={state.historyLoading}
              onClick={loadEarlier}
            >
              {state.historyLoading
                ? "Loading earlier activity…"
                : `Load earlier activity${hiddenTimelineItems > 0
                  ? ` (${Math.min(100, hiddenTimelineItems)} more)`
                  : ""}`}
            </button>
          )}
          {visibleTimeline.map((item) => (
            <Fragment key={item.timelineItemId}>
              <FeedItem
                item={item}
                sessionWorking={state.selected.projection?.run === "working"}
                onUndoUserMessage={item.category === "user-message" && item.source === "saved" && !working && synchronized && capabilities.includes("session.undo")
                  ? () => {
                      setDraft(item.content.text);
                      writeComposerDraft(selectedSessionIdentity, item.content.text);
                      setVoiceMode(false);
                      localStorage.setItem("pi-station:composer-mode", "text");
                      onCommand?.({ kind: "session.undo", entryId: item.timelineItemId });
                      requestAnimationFrame(() => composerInput.current?.focus());
                    }
                  : undefined}
                onOpenSharedMarkdown={(url) => {
                  const parsed = new URL(url, window.location.origin);
                  const projectPath = parsed.searchParams.get("path") ?? undefined;
                  openSharedMarkdown({
                    url,
                    name: projectPath?.split("/").pop() ?? decodeURIComponent(parsed.pathname.split("/").pop() ?? "Shared file"),
                    ...(projectPath === undefined ? {} : { projectPath }),
                  });
                }}
              />
              {item.category === "assistant-response" && (
                <button
                  className="speech-button"
                  type="button"
                  disabled={voiceState === "transcribing"}
                  aria-label={playingResponseId === item.timelineItemId ? "Stop response" : "Play response"}
                  onClick={() => playingResponseId === item.timelineItemId ? stopSpeech() : void playSpeech(item.content.text, item.timelineItemId)}
                >
                  {playingResponseId === item.timelineItemId
                    ? <Square aria-hidden="true" size={14} />
                    : <Play aria-hidden="true" size={14} />}
                </button>
              )}
            </Fragment>
          ))}
          {optimisticPrompt !== undefined && state.selected.timeline.filter(
            (item) => item.category === "user-message"
              && item.content.text === optimisticPrompt.text,
          ).length <= optimisticPrompt.baselineMatches && (
            <article
              className="message user optimistic"
              data-request-id={optimisticPrompt.requestId}
            >
              <div className="message-body">{optimisticPrompt.text}</div>
            </article>
          )}
          {showThinkingPlaceholder && (
            <article
              className="message thinking local-thinking-placeholder"
              role="status"
              aria-label="Pi is thinking"
            >
              <div className="message-body">
                <span className="thinking-placeholder-copy">
                  Thinking
                  <span className="thinking-dots" aria-hidden="true">
                    <span>.</span><span>.</span><span>.</span>
                  </span>
                </span>
              </div>
            </article>
          )}
        </section>

        <footer ref={composerShell} className="composer-shell">
          {showJumpToLatest && (
            <button
              className="jump-to-latest"
              type="button"
              aria-label="Jump to latest"
              onClick={() => {
                followsLatest.current = true;
                setShowJumpToLatest(false);
                window.scrollTo({
                  top: Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight,
                  ),
                  behavior: "auto",
                });
              }}
            >
              <ArrowDown aria-hidden="true" size={19} />
            </button>
          )}
          {queuedInputs.length > 0 && (
            <aside className="follow-up-queue" aria-label="Pending Session input">
            <header>
              <strong>{queuedInputs.length} pending {queuedInputs.length === 1 ? "message" : "messages"}</strong>
              <button
                type="button"
                disabled={clearQueuePending || queuedInputs.some((item) => item.status === "submitting")}
                onClick={() => {
                  const requestId = onCommand?.({ kind: "session.queue.clear" })
                  if (requestId !== undefined) setClearQueueRequestId(requestId)
                }}
              >
                {clearQueuePending ? "Canceling…" : "Cancel all"}
              </button>
            </header>
            <ul>
              {queuedInputs.map((item) => (
                <li key={item.requestId}>
                  <span>{item.text}</span>
                  <small>{item.status === "submitting"
                    ? "Sending…"
                    : item.delivery === "prompt.steer"
                      ? "Steering · applies during the current turn"
                      : "Follow-up · waits for the current turn"}</small>
                </li>
              ))}
            </ul>
            </aside>
          )}
          {voiceMode ? (
            <section className="voice-mode" aria-label="Voice mode">
              {composerFeedback !== undefined && <p className="composer-feedback" role="alert" title={composerFeedback}>{composerFeedback}</p>}
              <header>
                <span className="voice-mode-status">
                  <Button className="voice-mode-icon-action" variant="ghost" size="icon" type="button" role="switch" aria-checked={voiceAutoplay} aria-label={`Auto-play ${voiceAutoplay ? "on" : "off"}`} title={`Auto-play ${voiceAutoplay ? "on" : "off"}`} onClick={() => setVoiceAutoplay((value) => !value)}>{voiceAutoplay ? <Volume2 aria-hidden="true" size={18} /> : <VolumeX aria-hidden="true" size={18} />}</Button>
                  <span>{voiceState === "recording" ? "Listening…" : voiceState === "transcribing" ? "Transcribing and sending…" : voiceState === "playing" ? "Playing response…" : "Ready to record"}</span>
                </span>
                <span className="voice-mode-primary-slot"><Button className="voice-mode-icon-action" variant="ghost" size="icon" type="button" aria-label="Switch to typing mode" title="Switch to typing mode" onClick={() => { setVoiceMode(false); localStorage.setItem("pi-station:composer-mode", "text"); }}><Keyboard aria-hidden="true" size={18} /></Button></span>
              </header>
              <footer>
                <ComposerControls details={state.selected.details} delivery={workingDelivery} working={working} disabled={commandPending || voiceState !== "idle"} canChangeModel={capabilities.includes("session.model.set")} canChangeThinking={capabilities.includes("session.thinking.set")} onSetModel={(provider, modelId) => { const id = onCommand?.({ kind: "session.model.set", provider, modelId }); if (id !== undefined) setSessionSettingRequestId(id); }} onSetThinking={(level) => { const id = onCommand?.({ kind: "session.thinking.set", level }); if (id !== undefined) setSessionSettingRequestId(id); }} onSetDelivery={setWorkingDelivery} />
                <span className="voice-mode-primary-slot">
                  <Button className="voice-mode-record" variant="ghost" type="button" disabled={!commandAvailable || commandPending || voiceState === "transcribing"} data-state={voiceState} aria-label={voiceState === "recording" ? "Stop and send recording" : voiceState === "transcribing" ? "Transcribing and sending recording" : voiceState === "playing" ? "Stop response" : "Start recording"} onClick={() => { if (voiceState === "recording") stopVoiceRecording(true); else if (voiceState === "playing") stopSpeech(); else void startVoiceRecording(true); }}>
                    <span className="voice-mode-record-icon" aria-hidden="true">{voiceState === "transcribing" ? <LoaderCircle className="composer-spinner" size={26} /> : voiceState === "recording" || voiceState === "playing" ? <Square size={22} /> : <Mic size={26} />}</span>
                  </Button>
                </span>
              </footer>
            </section>
          ) : <form
            className="composer"
            onPaste={(event) => {
              if (addPastedAttachments(event.clipboardData)) event.preventDefault();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt();
            }}
          >
            {composerFeedback !== undefined && <p className="composer-feedback" role="alert" title={composerFeedback}>{composerFeedback}</p>}
            <input
              ref={fileInput}
              type="file"
              accept="*/*"
              multiple
              hidden
              onChange={(event) => {
                const selected = [...(event.target.files ?? [])];
                addSelectedAttachments(selected);
                event.target.value = "";
              }}
            />
            {files.length > 0 && <div className="composer-files" aria-label="Attached files">{files.map((file) => <span key={file.localId} className={`composer-file ${file.status}`}><Paperclip aria-hidden="true" size={14} /> {file.name} · {file.status === "uploading" ? "Uploading…" : file.status === "error" ? "Failed" : "Ready"}<button type="button" onClick={() => discardFile(file)} aria-label={`Remove ${file.name}`}><X aria-hidden="true" size={14} /></button></span>)}</div>}
            {images.length > 0 && (
              <div className="composer-images" aria-label="Attached images">
                {images.map((image) => (
                  <figure key={image.localId} className={`composer-image ${image.status}`}>
                    <img src={image.previewUrl} alt={image.name} />
                    <span>{image.status === "uploading" ? "Uploading…" : image.status === "error" ? "Failed" : "Ready"}</span>
                    <button type="button" onClick={() => discardImage(image)} aria-label={`Remove ${image.name}`}>
                      <X aria-hidden="true" size={14} />
                    </button>
                  </figure>
                ))}
              </div>
            )}
            {slashCommandQuery !== undefined && (
              <SlashCommandMenu
                options={filteredSlashCommands}
                query={slashCommandQuery}
                activeIndex={slashCommandIndex}
                onActiveIndexChange={setSlashCommandIndex}
                onSelect={selectSlashCommand}
              />
            )}
            {agentMention !== undefined && (
              <AgentMentionMenu
                options={filteredAgentMentions}
                query={agentMention.query}
                activeIndex={agentMentionIndex}
                onActiveIndexChange={setAgentMentionIndex}
                onSelect={selectAgentMention}
              />
            )}
            <label className="sr-only" htmlFor="prompt">
              Message Pi
            </label>
            <textarea
              ref={composerInput}
              id="prompt"
              value={draft}
              onChange={(event) => {
                const next = event.target.value;
                const cursor = event.target.selectionStart;
                setDraft(next);
                setSelectedAgentMentions((current) => current.filter((mention) => next.includes(mention.token)));
                writeComposerDraft(selectedSessionIdentity, next);
                const match = next.slice(0, cursor).match(/(?:^|\s)@([^@\n]*)$/u);
                const start = match === null ? -1 : cursor - (match[1]?.length ?? 0) - 1;
                const followsSelectedMention = selectedAgentMentions.some((mention) => (
                  next.startsWith(mention.token, start) && cursor >= start + mention.token.length
                ));
                if (match === null || followsSelectedMention) setAgentMention(undefined);
                else {
                  setAgentMention({ start, query: match[1] ?? "" });
                  setAgentMentionIndex(0);
                }
                const slashMatch = next.slice(0, cursor).match(/^\/([^\s/]*)$/u);
                if (slashMatch === null) setSlashCommandQuery(undefined);
                else {
                  setSlashCommandQuery(slashMatch[1] ?? "");
                  setSlashCommandIndex(0);
                  setAgentMention(undefined);
                }
              }}
              placeholder="Message your agent..."
              disabled={!commandAvailable || commandPending || voiceState !== "idle"}
              onKeyDown={(event) => {
                if (slashCommandQuery !== undefined) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    setSlashCommandIndex((current) => filteredSlashCommands.length === 0 ? 0 : (current + direction + filteredSlashCommands.length) % filteredSlashCommands.length);
                    return;
                  }
                  if ((event.key === "Enter" || event.key === "Tab") && filteredSlashCommands[slashCommandIndex] !== undefined) {
                    event.preventDefault();
                    selectSlashCommand(filteredSlashCommands[slashCommandIndex]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSlashCommandQuery(undefined);
                    return;
                  }
                }
                if (agentMention !== undefined) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    setAgentMentionIndex((current) => filteredAgentMentions.length === 0 ? 0 : (current + direction + filteredAgentMentions.length) % filteredAgentMentions.length);
                    return;
                  }
                  if ((event.key === "Enter" || event.key === "Tab") && filteredAgentMentions[agentMentionIndex] !== undefined) {
                    event.preventDefault();
                    selectAgentMention(filteredAgentMentions[agentMentionIndex]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setAgentMention(undefined);
                    return;
                  }
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
            />
            <div className="composer-controls">
              <span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!commandAvailable || commandPending || images.length >= 4}
                  aria-label="Attach files"
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip aria-hidden="true" size={17} />
                </Button>
                <ComposerControls details={state.selected.details} delivery={workingDelivery} working={working} disabled={commandPending} canChangeModel={capabilities.includes("session.model.set")} canChangeThinking={capabilities.includes("session.thinking.set")} onSetModel={(provider, modelId) => { const id = onCommand?.({ kind: "session.model.set", provider, modelId }); if (id !== undefined) setSessionSettingRequestId(id); }} onSetThinking={(level) => { const id = onCommand?.({ kind: "session.thinking.set", level }); if (id !== undefined) setSessionSettingRequestId(id); }} onSetDelivery={setWorkingDelivery} />
              </span>
              <span className="composer-primary-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  className="composer-transcription-button"
                  data-state={voiceState === "transcribing" ? "processing" : voiceState}
                  type="button"
                  disabled={!commandAvailable || commandPending || !voiceConfiguration.configured || voiceState === "transcribing"}
                  aria-label={voiceState === "recording" ? "Stop and transcribe recording" : voiceState === "transcribing" ? "Transcribing recording" : "Record message"}
                  title={!voiceConfiguration.configured ? "Add an OpenAI API key in Voice Messages settings" : undefined}
                  onClick={() => voiceState === "recording" ? stopVoiceRecording(true) : void startVoiceRecording(false)}
                >
                  {voiceState === "recording" ? <Square aria-hidden="true" size={15} /> : voiceState === "transcribing" ? <LoaderCircle className="composer-spinner" aria-hidden="true" size={18} /> : <Mic aria-hidden="true" size={18} />}
                </Button>
                <button
                  type={draft.trim().length === 0 && images.length === 0 && files.length === 0 ? "button" : "submit"}
                  disabled={!commandAvailable || commandPending || voiceState !== "idle" || images.some((image) => image.status !== "ready") || files.some((file) => file.status !== "ready") || (!voiceConfiguration.configured && draft.trim().length === 0 && images.length === 0 && files.length === 0)}
                  aria-label={draft.trim().length === 0 && images.length === 0 && files.length === 0 ? "Open voice mode" : "Send message"}
                  onClick={draft.trim().length === 0 && images.length === 0 && files.length === 0 ? () => { setVoiceMode(true); localStorage.setItem("pi-station:composer-mode", "voice"); } : undefined}
                >
                  {draft.trim().length === 0 && images.length === 0 && files.length === 0 ? <AudioWaveform aria-hidden="true" size={18} /> : <ArrowUp aria-hidden="true" size={18} />}
                </button>
              </span>
            </div>
          </form>}
        </footer>
      </section>

      {sharedMarkdownFile !== undefined && (
        <Suspense fallback={<p className="page-loading" role="status">Loading editor…</p>}>
          <SharedMarkdownEditor
            key={`${editorIdentity}:${sharedMarkdownFile.url}`}
            file={sharedMarkdownFile}
            draftKey={`pi-station:shared-markdown-draft:${editorIdentity}`}
            onClose={closeSharedMarkdown}
            onDirtyChange={setCurrentEditorDirty}
          />
        </Suspense>
      )}

      {detailsOpen && selectedSummary !== undefined && selectedSummary.quickSession !== true && (
        <Suspense fallback={<p className="page-loading" role="status">Loading…</p>}>
        <SessionDetails
          state={state}
          summary={selectedSummary}
          {...(selectedProject === undefined ? {} : { project: selectedProject })}
          bookmarked={selectedSessionBookmarked}
          bookmarkSaving={detailsBookmarkMutation?.status === "saving"}
          canCloseSession={state.selected.projection?.capabilities.some(
            (capability) => capability === "session.close",
          ) ?? false}
          canCloneSession={synchronized && state.selected.projection?.run === "idle" && state.selected.projection.capabilities.some(
            (capability) => capability === "session.clone",
          )}
          canRestartSession={synchronized && state.selected.projection?.run === "idle" && state.selected.projection?.management.kind === "managed"}
          restartSaving={restartSessionPending}
          {...(restartSessionError === undefined || restartSessionTarget !== undefined ? {} : { restartError: restartSessionError })}
          canReloadSession={synchronized && state.selected.projection?.run === "idle" && (
            state.selected.projection.capabilities.some(
              (capability) => capability === "session.reload",
            )
          )}
          canRenameSession={state.selected.projection?.capabilities.some(
            (capability) => capability === "session.rename",
          ) ?? false}
          settingSaving={sessionSettingPending}
          reloadSaving={reloadSessionPending}
          {...(reloadSessionError === undefined
            ? {}
            : { reloadError: reloadSessionError })}
          {...(detailsBookmarkMutation?.result?.status === "rejected"
            || detailsBookmarkMutation?.result?.status === "retryable"
            ? { bookmarkError: detailsBookmarkMutation.result.error.message }
            : {})}
          {...(selectedDevelopmentServer === undefined ? {} : { developmentServer: selectedDevelopmentServer })}
          {...(selectedDevelopmentServer === undefined || state.developmentServerOutput[selectedDevelopmentServer.projectId] === undefined
            ? {}
            : { developmentServerOutput: state.developmentServerOutput[selectedDevelopmentServer.projectId] })}
          developmentServerPending={developmentServerPending}
          {...(developmentServerError === undefined ? {} : { developmentServerError })}
          onStartDevelopmentServer={() => {
            if (selectedDevelopmentServer === undefined) return;
            const requestId = onStartDevelopmentServer?.(selectedDevelopmentServer.projectId);
            if (requestId !== undefined) setDevelopmentServerRequestId(requestId);
          }}
          onStopDevelopmentServer={() => {
            if (selectedDevelopmentServer === undefined) return;
            const requestId = onStopDevelopmentServer?.(selectedDevelopmentServer.projectId);
            if (requestId !== undefined) setDevelopmentServerRequestId(requestId);
          }}
          onViewDevelopmentServerOutput={() => {
            if (selectedDevelopmentServer === undefined) return;
            const requestId = onViewDevelopmentServerOutput?.(selectedDevelopmentServer.projectId);
            if (requestId !== undefined) setDevelopmentServerRequestId(requestId);
          }}
          onRequestCloseSession={() => {
            setCloseSessionRequestId(undefined);
            setCloseSessionTarget(undefined);
            setCloseSessionConfirmOpen(true);
          }}
          onCloneSession={() => {
            const requestId = onCommand?.({ kind: "session.clone" });
            if (requestId !== undefined && selectedSummary !== undefined) {
              const originalName = state.selected.details?.name ?? selectedSummary.name ?? "Untitled Session";
              cloneSource.current = {
                source: selectedSummary.sessionKey,
                workingDirectory: state.selected.details?.currentDirectoryDisplay
                  ?? selectedSummary.displayPath
                  ?? selectedProject?.displayPath
                  ?? "",
                cloneName: `${[...originalName].slice(0, 114).join("")}-clone`,
              };
              setCloneSessionRequestId(requestId);
            }
          }}
          onReloadSession={() => {
            const requestId = onCommand?.({ kind: "session.reload" });
            if (requestId !== undefined) setReloadSessionRequestId(requestId);
          }}
          onRestartSession={() => {
            const sessionKey = state.selectedSessionKey;
            const generationId = state.selected.generationId;
            if (sessionKey === undefined || generationId === undefined) return;
            setRestartSessionRequestId(undefined);
            setRestartSessionLaunchError(undefined);
            setDetailsOpen(false);
            setRestartSessionTarget({ sessionKey, generationId });
          }}
          onRenameSession={(name) => {
            const requestId = onCommand?.({ kind: "session.rename", name });
            if (requestId !== undefined) setSessionSettingRequestId(requestId);
          }}
          onOpenProject={() => {
            if (selectedProject === undefined) return;
            setSelectedProjectId(selectedProject.projectId);
            setDetailsOpen(false);
            setRoute("project");
          }}
          onNewSession={() => {
            if (selectedProject === undefined) return;
            setNewSessionProject(selectedProject);
            setDetailsOpen(false);
          }}
          projects={state.projects}
          onMoveSession={(projectId) => { onCommand?.({ kind: "session.move", projectId }); }}
          onCancelMove={() => { onCommand?.({ kind: "session.move.cancel" }); }}
          onOpenSharedMarkdown={openSharedMarkdown}
          onSetBookmark={(bookmarked) => {
            if (selectedProject === undefined) return;
            const requestId = onSetSessionBookmark?.(
              selectedProject.projectId,
              selectedSummary.sessionKey,
              bookmarked,
            );
            if (requestId !== undefined) setDetailsBookmarkRequestId(requestId);
          }}
        />
        </Suspense>
      )}

      <Modal
        open={discardSharedMarkdownAction !== undefined}
        title="Discard unsaved changes?"
        description="Unsaved file changes or message attachments will be discarded. Your message text is kept."
        onClose={cancelNavigation}
        actions={(
          <>
            <button type="button" className="modal-button secondary" onClick={cancelNavigation}>Keep editing</button>
            <button type="button" className="modal-button danger" onClick={() => {
              const action = discardSharedMarkdownAction;
              discardSharedMarkdownCancel.current = undefined;
              setDiscardSharedMarkdownAction(undefined);
              discardCurrentEditorDraft();
              setCurrentEditorDirty(false);
              for (const image of images) discardImage(image);
              for (const file of files) discardFile(file);
              action?.();
            }}>Discard changes</button>
          </>
        )}
      ><p>Your unsaved changes will be lost.</p></Modal>

      <Modal
        open={renameSession !== undefined}
        title="Rename Session"
        initialFocus={renameSessionNameInput}
        onClose={() => setRenameSession(undefined)}
        onSubmit={(event) => {
          event.preventDefault();
          const name = renameSessionName.trim();
          if (renameSession === undefined || name.length === 0) return;
          const requestId = onCommand?.(
            { kind: "session.rename", name },
            renameSession.sessionKey,
          );
          if (requestId !== undefined) {
            setSessionSettingRequestId(requestId);
            setRenameSession(undefined);
          }
        }}
        actions={(
          <>
            <button type="button" className="modal-button secondary" onClick={() => setRenameSession(undefined)}>Cancel</button>
            <button type="submit" className="modal-button primary" disabled={renameSessionName.trim().length === 0}>Rename</button>
          </>
        )}
      >
        <label className="modal-field">
          <span>New name</span>
          <input ref={renameSessionNameInput} value={renameSessionName} onChange={(event) => setRenameSessionName(event.target.value)} />
        </label>
      </Modal>

      <AlertDialog open={state.selected.commandApproval !== undefined} onOpenChange={(open) => {
        if (!open && !commandApprovalPending) respondToCommandApproval(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.selected.commandApproval?.kind === "delegation" ? "Approve delegation settings?" : "Run recursive rm command?"}</AlertDialogTitle>
            <AlertDialogDescription>{state.selected.commandApproval?.kind === "delegation"
              ? "An agent supplied settings for a new child Session."
              : "This command can permanently delete files."}</AlertDialogDescription>
          </AlertDialogHeader>
          {state.selected.commandApproval?.kind === "delegation" ? (
            <dl className="command-approval-command">
              <dt>Model</dt><dd>{state.selected.commandApproval.model}</dd>
              <dt>Thinking</dt><dd>{state.selected.commandApproval.thinkingLevel}</dd>
            </dl>
          ) : (
            <pre className="command-approval-command"><code>{state.selected.commandApproval?.command}</code></pre>
          )}
          {commandApprovalError !== undefined && <p className="modal-error" role="alert">{commandApprovalError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commandApprovalPending} onClick={(event) => {
              event.preventDefault();
              respondToCommandApproval(false);
            }}>{state.selected.commandApproval?.kind === "delegation" ? "Reject" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction variant={state.selected.commandApproval?.kind === "delegation" ? "default" : "destructive"} disabled={commandApprovalPending} onClick={(event) => {
              event.preventDefault();
              respondToCommandApproval(true);
            }}>{commandApprovalPending ? "Responding…" : state.selected.commandApproval?.kind === "delegation" ? "Approve" : "Run command"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeSessionConfirmOpen} onOpenChange={(open) => {
        if (closeSessionPending) return;
        setCloseSessionConfirmOpen(open);
        if (!open) setCloseSessionTarget(undefined);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{closeSessionTitle}</AlertDialogTitle>
            <AlertDialogDescription>Pi will close this Session. The saved conversation will remain available.</AlertDialogDescription>
          </AlertDialogHeader>
          {closeSessionError !== undefined && <p className="modal-error" role="alert">{closeSessionError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeSessionPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={closeSessionPending} onClick={(event) => {
              event.preventDefault();
              if (!closeSessionPending) requestSessionClose();
            }}>{closeSessionPending ? "Closing…" : "Close Session"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Modal
        open={restartSessionTarget !== undefined}
        title={restartSessionSucceeded ? "Session restarted" : "Restart Session?"}
        busy={restartSessionPending}
        onClose={() => {
          if (!restartSessionPending) setRestartSessionTarget(undefined);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (restartSessionTarget === undefined || restartSessionPending || restartSessionSucceeded) return;
          setRestartSessionLaunchError(undefined);
          const requestId = onRestartManagedSession?.(
            restartSessionTarget.sessionKey,
            restartSessionTarget.generationId,
          );
          if (requestId === undefined) {
            setRestartSessionLaunchError("Pi Station could not send the restart request. The restart did not start.");
            return;
          }
          setRestartSessionRequestId(requestId);
        }}
        actions={(
          <>
            <button type="button" className="modal-button secondary" disabled={restartSessionPending} onClick={() => setRestartSessionTarget(undefined)}>
              {restartSessionSucceeded || restartSessionOutcomeUnknown ? "Close" : "Cancel"}
            </button>
            {!restartSessionSucceeded && !restartSessionOutcomeUnknown && (
              <button type="submit" className="modal-button danger" disabled={restartSessionPending}>
                {restartSessionPending ? "Restarting…" : restartSessionRequestId === undefined ? "Restart Session" : "Try again"}
              </button>
            )}
          </>
        )}
      >
        {restartSessionSucceeded ? (
          <p role="status">The Session restarted successfully.</p>
        ) : (
          <p>The current Pi process will stop. Pi Station will resume the same Session.</p>
        )}
        {restartSessionPending && <p role="status">Restarting Session…</p>}
        {restartSessionError !== undefined && (
          <p className="modal-error" role="alert">
            {restartSessionOutcomeUnknown ? `Restart outcome is unknown. ${restartSessionError}` : restartSessionError}
          </p>
        )}
      </Modal>



      {newSessionModal}

      {paletteOpen && (
        <CommandPalette
          onClose={() => { setPaletteOpen(false); setPaletteInitialFlow("actions"); }}
          initialFlow={paletteInitialFlow}
          sessionName={selectedSessionName}
          sessionId={selectedSummary?.sessionKey.piSessionId}
          projectName={selectedProject?.name}
          projectPath={selectedProject?.displayPath}
          projects={state.projects}
          workspaces={state.workspaces}
          activeWorkspaceId={state.activeWorkspaceId}
          directoryLists={state.directoryLists}
          managedSessionCreates={state.managedSessionCreates}
          projectCreates={state.projectCreates}
          bookmarked={selectedSessionBookmarked}
          working={working}
          canCreateSession={state.hostCapabilities.some(
            (capability) => capability === "managed-session.create",
          )}
          canAbort={synchronized && capabilities.includes("session.abort")}
          canClose={synchronized && capabilities.includes("session.close")}
          canClone={synchronized && !working && capabilities.includes("session.clone")}
          canRename={synchronized && capabilities.includes("session.rename")}
          canChangeModel={synchronized && capabilities.includes("session.model.set")}
          canChangeThinking={synchronized && capabilities.includes("session.thinking.set")}
          models={state.selected.details?.modelInventory}
          thinkingLevels={state.selected.details?.supportedThinkingLevels}
          currentModel={state.selected.details?.model}
          currentThinking={state.selected.details?.thinkingLevel}
          sessions={state.sessions.flatMap((session) => {
            const name = session.name?.trim();
            if (!name) return [];
            return [{
              id: session.sessionKey.piSessionId,
              name,
              projectName: state.projects.find((project) => project.projectId === session.projectId)?.name,
              closed: session.projection.availability === "closed",
            }];
          })}
          stashes={stashes}
          pending={sessionSettingPending || closeSessionPending || stashPending}
          error={sessionSettingError ?? closeSessionError}
          onDashboard={() => setRoute("dashboard")}
          onProjects={() => setRoute("projects")}
          onAddProject={() => setRoute("add-project")}
          onCreateProject={(name, directory) => onCreateProject?.(name, directory)}
          onProjectCreated={(projectId) => {
            setSelectedProjectId(projectId);
            setRoute("project");
          }}
          onListDirectory={(path, showHidden) => onListDirectory?.(path, showHidden)}
          onCreateSession={(workingDirectory, optionalName) => onCreateManagedSession?.(workingDirectory, optionalName)}
          onSessionStarted={(sessionKey) => {
            focusComposerForSession.current = isDesktopViewport() ? sessionKey : undefined;
          }}
          onOpenProject={selectedProject === undefined ? undefined : () => {
            setSelectedProjectId(selectedProject.projectId);
            setRoute("project");
          }}
          onSessionDetails={() => setDetailsOpen(true)}
          onRename={(name) => {
            const requestId = onCommand?.({ kind: "session.rename", name });
            if (requestId !== undefined) setSessionSettingRequestId(requestId);
          }}
          onSetModel={(provider, modelId) => {
            const requestId = onCommand?.({ kind: "session.model.set", provider, modelId });
            if (requestId !== undefined) setSessionSettingRequestId(requestId);
          }}
          onSetThinking={(level) => {
            const requestId = onCommand?.({ kind: "session.thinking.set", level });
            if (requestId !== undefined) setSessionSettingRequestId(requestId);
          }}
          onRestoreStash={(stash) => { void restoreStash(stash); }}
          onSelectWorkspace={(id) => {
            void activateWorkspace(id).catch((reason: unknown) => toast({
              message: reason instanceof Error ? reason.message : "Workspace could not be opened. Try again.",
              variant: "error",
            }));
          }}
          onOpenSession={(id) => {
            const session = state.sessions.find((candidate) => candidate.sessionKey.piSessionId === id);
            if (session) afterSharedMarkdownCheck(() => openSession(session.sessionKey));
          }}
          onSetBookmark={selectedProject === undefined || selectedSummary === undefined
            ? undefined
            : (bookmarked) => {
                onSetSessionBookmark?.(
                  selectedProject.projectId,
                  selectedSummary.sessionKey,
                  bookmarked,
                );
              }}
          onClone={() => {
            const requestId = onCommand?.({ kind: "session.clone" });
            if (requestId !== undefined && selectedSummary !== undefined) {
              const originalName = state.selected.details?.name ?? selectedSummary.name ?? "Untitled Session";
              cloneSource.current = {
                source: selectedSummary.sessionKey,
                workingDirectory: state.selected.details?.currentDirectoryDisplay
                  ?? selectedSummary.displayPath
                  ?? selectedProject?.displayPath
                  ?? "",
                cloneName: `${[...originalName].slice(0, 114).join("")}-clone`,
              };
              setCloneSessionRequestId(requestId);
            }
          }}
          onAbort={abort}
          onConfirmClose={requestSessionClose}
        />
      )}
    </main>
    </div>
    </Sheet>
    {contextMenu}
    </>
  );
}
