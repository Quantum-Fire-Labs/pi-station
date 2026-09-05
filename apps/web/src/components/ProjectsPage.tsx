import { useState, type KeyboardEvent } from "react";
import "./project-work-hub.css";
import "./project-accordion.css";
import { ArrowDown, ArrowUp, ChevronRight, Folder, Plus, Search } from "lucide-react";
import type { ProjectId, ProjectSummary, SessionKey, SessionSummary } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { activityDate, sessionActivityTime, sessionWorkStatus } from "./project-work-summary";
import { MobileNavigationMenu } from "./MobileNavigationMenu";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

export function ProjectsPage({
  state,
  onOpen,
  onAdd,
  onNewSession,
  onOpenDirectory = () => onNewSession(),
  onOpenSession,
  onDashboard,
  onProjects,
  onSettings,
  onReorderBookmark,
  onSetProjectClosed = () => Promise.reject(new Error("Project state changes are unavailable")),
}: {
  state: ApplicationState;
  onOpen: (projectId: ProjectId) => void;
  onAdd: () => void;
  onNewSession: (project?: ProjectSummary) => void;
  onOpenDirectory?: () => void;
  onOpenSession?: (key: SessionKey) => void;
  onDashboard: () => void;
  onProjects: () => void;
  onSettings: () => void;
  onReorderBookmark: (projectId: ProjectId, direction: "up" | "down") => string | undefined;
  onSetProjectClosed?: (projectId: ProjectId, closed: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [expanded, setExpanded] = useState<ReadonlySet<ProjectId>>(new Set());
  const toggleExpanded = (id: ProjectId): void => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const recentSessions = new Map<ProjectId, SessionSummary[]>();
  const latestSessions = new Map<ProjectId, ApplicationState["sessions"][number]>();
  for (const session of state.sessions) {
    if (session.projectId === undefined || session.parentSessionKey !== undefined || session.quickSession === true) continue;
    const projectSessions = recentSessions.get(session.projectId) ?? [];
    projectSessions.push(session);
    recentSessions.set(session.projectId, projectSessions);
    const previous = latestSessions.get(session.projectId);
    if (previous === undefined || sessionActivityTime(session) > sessionActivityTime(previous)) latestSessions.set(session.projectId, session);
  }
  const projectTime = (project: ProjectSummary): number => {
    const session = latestSessions.get(project.projectId);
    return session === undefined ? 0 : sessionActivityTime(session);
  };
  const [mutationRequestId, setMutationRequestId] = useState<string>();
  const [projectSaving, setProjectSaving] = useState<ProjectId>();
  const [projectError, setProjectError] = useState<string>();
  const mutation = mutationRequestId === undefined ? undefined : state.bookmarkMutations[mutationRequestId];
  const saving = mutation?.status === "saving";
  const error = mutation?.result?.status === "rejected" || mutation?.result?.status === "retryable"
    ? mutation.result.error.message
    : undefined;
  const positions = new Map(state.projectBookmarks
    .map((bookmark) => [bookmark.projectId, bookmark.position]));
  const matchesQuery = (project: ApplicationState["projects"][number]): boolean => {
    const search = query.trim().toLocaleLowerCase();
    return search.length === 0
      || project.name.toLocaleLowerCase().includes(search)
      || project.displayPath.toLocaleLowerCase().includes(search);
  };
  const bookmarked = state.projects
    .filter((project) => positions.has(project.projectId) && matchesQuery(project))
    .sort((left, right) => (positions.get(left.projectId) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.projectId) ?? Number.MAX_SAFE_INTEGER));
  const other = state.projects
    .filter((project) => !positions.has(project.projectId) && matchesQuery(project))
    .sort((left, right) => (sort === "recent" ? projectTime(right) - projectTime(left) : 0) || compareProjects(left, right));
  const hasResults = bookmarked.length + other.length > 0;
  const setClosed = (projectId: ProjectId, value: boolean): void => {
    setProjectSaving(projectId);
    setProjectError(undefined);
    void onSetProjectClosed(projectId, value)
      .catch((reason: unknown) => setProjectError(reason instanceof Error ? reason.message : "Project state could not be changed"))
      .finally(() => setProjectSaving(undefined));
  };
  return (
    <main className="projects-index projects-index-page">
      <div className="projects-page-shell">
        <header className="projects-page-header">
          <div className="projects-page-heading">
            <h1>Projects</h1>
            <p>Find a directory. Continue a conversation. Start something new.</p>
          </div>
          <div className="projects-page-header-actions">
            <Button type="button" variant="ghost" onClick={onOpenDirectory}>Open directory</Button>
            <Button type="button" onClick={onAdd}><Plus data-icon="inline-start" aria-hidden="true" />Add Project</Button>
          </div>
          <MobileNavigationMenu current="projects" onNewSession={() => onNewSession()} onNewProject={onAdd} onDashboard={onDashboard} onProjects={onProjects} onSettings={onSettings} />
        </header>

        {state.projects.length === 0 ? (
          <div className="projects-page-empty">
            <Folder aria-hidden="true" size={22} />
            <h2>No Projects yet.</h2>
            <p>Save a directory here for easy access, or open a directory without adding a Project.</p>
            <Button type="button" onClick={onAdd}>Add Project</Button>
          </div>
        ) : (
          <div className="projects-page-content">
            <div className="projects-page-toolbar">
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a Project by name or path" aria-label="Search Projects" />
              <label className="projects-sort">Sort<select aria-label="Sort Projects" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recent activity</option><option value="name">Name</option></select></label>
            </div>
            {hasResults ? (
              <>
                {bookmarked.length > 0 && <ProjectGroup expanded={expanded} onToggle={toggleExpanded} recentSessions={recentSessions} onOpenSession={onOpenSession} latestSessions={latestSessions} title="Bookmarked" projects={bookmarked} onOpen={onOpen} onNewSession={onNewSession} saving={saving} onReorder={(projectId, direction) => {
                  const requestId = onReorderBookmark(projectId, direction);
                  if (requestId !== undefined) setMutationRequestId(requestId);
                }} {...(projectSaving === undefined ? {} : { projectSaving })} onSetClosed={setClosed} />}
                {other.length > 0 && <ProjectGroup expanded={expanded} onToggle={toggleExpanded} recentSessions={recentSessions} onOpenSession={onOpenSession} latestSessions={latestSessions} title="Other Projects" projects={other} onOpen={onOpen} onNewSession={onNewSession} saving={saving} {...(projectSaving === undefined ? {} : { projectSaving })} onSetClosed={setClosed} />}
              </>
            ) : (
              <div className="projects-page-no-results"><Search aria-hidden="true" /><strong>No matching Projects</strong><span>Try a different name or path.</span></div>
            )}
            {(error ?? projectError) && <p className="new-session-error" role="alert">{error ?? projectError}</p>}
          </div>
        )}
      </div>
    </main>
  );
}

function ProjectActivityDate({ session }: { session: SessionSummary | undefined }) {
  const time = session === undefined ? 0 : sessionActivityTime(session);
  return <time className="project-activity-date" dateTime={time === 0 ? undefined : new Date(time).toISOString()} title={time === 0 ? undefined : `Last activity: ${new Date(time).toLocaleString()}`}>{activityDate(time)}</time>;
}

function RecentSessions({ sessions, onOpenSession, onViewAll, projectName }: {
  sessions: readonly SessionSummary[];
  onOpenSession: ((key: SessionKey) => void) | undefined;
  onViewAll: () => void;
  projectName: string;
}) {
  const recent = [...sessions].sort((left, right) => sessionActivityTime(right) - sessionActivityTime(left) || left.sessionKey.piSessionId.localeCompare(right.sessionKey.piSessionId)).slice(0, 5);
  return <>
    {recent.length === 0 ? <p>No Sessions yet.</p> : <ul aria-label={`Recent Sessions in ${projectName}`}>{recent.map((session) => {
      const status = sessionWorkStatus(session);
      const openable = ["available", "reconnecting", "closed"].includes(session.projection.availability);
      return <li key={session.sessionKey.piSessionId}><button type="button" className="project-recent-session" disabled={!openable || onOpenSession === undefined} onClick={() => onOpenSession?.(session.sessionKey)}>
        <span className="project-recent-session-name">{session.name || "Untitled Session"}</span>
        <span className={`project-work-status status-${status.toLowerCase()}`}><i aria-hidden="true" />{status}</span>
        <ProjectActivityDate session={session} />
      </button></li>;
    })}</ul>}
    <button type="button" className="project-view-all" onClick={onViewAll}>View all sessions</button>
  </>;
}

const compareProjects = (left: ApplicationState["projects"][number], right: ApplicationState["projects"][number]): number => (
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.projectId.localeCompare(right.projectId)
);

function ProjectGroup({ title, projects, latestSessions, recentSessions, expanded, onToggle, onOpenSession, onOpen, onNewSession, saving, onReorder, projectSaving, onSetClosed }: {
  title: string;
  projects: ApplicationState["projects"];
  latestSessions: ReadonlyMap<ProjectId, ApplicationState["sessions"][number]>;
  recentSessions: ReadonlyMap<ProjectId, readonly SessionSummary[]>;
  expanded: ReadonlySet<ProjectId>;
  onToggle: (id: ProjectId) => void;
  onOpenSession: ((key: SessionKey) => void) | undefined;
  onOpen: (projectId: ProjectId) => void;
  onNewSession: (project: ProjectSummary) => void;
  saving: boolean;
  onReorder?: (projectId: ProjectId, direction: "up" | "down") => void;
  projectSaving?: ProjectId;
  onSetClosed?: (projectId: ProjectId, closed: boolean) => void;
}) {
  const headingId = `projects-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section className="projects-page-group" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}<span aria-hidden="true">{projects.length}</span></h2>
      <Card className="projects-page-list bg-transparent" role="list">
        {projects.map((project, index) => (
          <div className={`projects-page-row${project.available ? "" : " unavailable"}`} key={project.projectId} role="listitem">
            <div className="project-accordion-heading">
            <button className="project-disclosure" type="button" aria-label={`Recent Sessions in ${project.name}`} aria-expanded={expanded.has(project.projectId)} aria-controls={`recent-${project.projectId}`} onClick={() => onToggle(project.projectId)}><ChevronRight aria-hidden="true" size={16} /></button>
            <div className="projects-page-row-open" role="button" tabIndex={0} aria-label={`${project.closed === true ? "View" : "Open"} ${project.name}`} onClick={() => onOpen(project.projectId)} onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(project.projectId);
            }}>
              <span className="projects-page-row-icon"><Folder aria-hidden="true" size={18} /></span>
              <div className="projects-page-row-copy"><h3>{project.name}</h3><span title={project.displayPath}>{project.displayPath}</span>{!project.available && <Badge variant="outline">Unavailable</Badge>}</div>
              <ProjectActivityDate session={latestSessions.get(project.projectId)} />
            </div>
            <div className="projects-page-row-actions">
              {project.closed === true && onSetClosed !== undefined ? <Button type="button" variant="outline" disabled={projectSaving !== undefined} onClick={() => onSetClosed(project.projectId, false)}>{projectSaving === project.projectId ? "Opening…" : "Open Project"}</Button> : <Button type="button" variant="ghost" size="icon" className="project-new-session-icon" aria-label={`New Session in ${project.name}`} title={`New Session in ${project.name}`} disabled={!project.available} onClick={() => onNewSession(project)}><Plus aria-hidden="true" size={16} /></Button>}
              {onReorder !== undefined && <span className="projects-page-order" role="group" aria-label={`Change ${project.name} order`}>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${project.name} up`} disabled={saving || index === 0} onClick={() => onReorder(project.projectId, "up")}><ArrowUp aria-hidden="true" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${project.name} down`} disabled={saving || index === projects.length - 1} onClick={() => onReorder(project.projectId, "down")}><ArrowDown aria-hidden="true" /></Button>
              </span>}
            </div>
            </div>
            <div id={`recent-${project.projectId}`} hidden={!expanded.has(project.projectId)} className="project-recent-sessions">
              {expanded.has(project.projectId) && <RecentSessions sessions={recentSessions.get(project.projectId) ?? []} onOpenSession={onOpenSession} onViewAll={() => onOpen(project.projectId)} projectName={project.name} />}
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
