import { useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Folder, Plus, Search } from "lucide-react";
import type { ProjectId, SavedWorkspace } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
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
  onDashboard,
  onProjects,
  onSettings,
  onReorderBookmark,
  onSetProjectClosed = () => Promise.reject(new Error("Project state changes are unavailable")),
  activeWorkspace,
  onOpenInWorkspace,
  onRemoveFromWorkspace,
}: {
  state: ApplicationState;
  onOpen: (projectId: ProjectId) => void;
  onAdd: () => void;
  onNewSession: () => void;
  onDashboard: () => void;
  onProjects: () => void;
  onSettings: () => void;
  onReorderBookmark: (projectId: ProjectId, direction: "up" | "down") => string | undefined;
  onSetProjectClosed?: (projectId: ProjectId, closed: boolean) => Promise<void>;
  activeWorkspace?: SavedWorkspace | undefined;
  onOpenInWorkspace?: ((projectId: ProjectId) => Promise<void>) | undefined;
  onRemoveFromWorkspace?: ((projectId: ProjectId) => Promise<void>) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [mutationRequestId, setMutationRequestId] = useState<string>();
  const [projectSaving, setProjectSaving] = useState<ProjectId>();
  const [projectError, setProjectError] = useState<string>();
  const mutation = mutationRequestId === undefined ? undefined : state.bookmarkMutations[mutationRequestId];
  const saving = mutation?.status === "saving";
  const error = mutation?.result?.status === "rejected" || mutation?.result?.status === "retryable"
    ? mutation.result.error.message
    : undefined;
  const workspaceProjectIds = new Set(activeWorkspace?.projectIds ?? state.projects.map(({ projectId }) => projectId));
  const positions = new Map(state.projectBookmarks
    .filter(({ projectId }) => workspaceProjectIds.has(projectId))
    .map((bookmark) => [bookmark.projectId, bookmark.position]));
  const matchesQuery = (project: ApplicationState["projects"][number]): boolean => {
    const search = query.trim().toLocaleLowerCase();
    return search.length === 0
      || project.name.toLocaleLowerCase().includes(search)
      || project.displayPath.toLocaleLowerCase().includes(search);
  };
  const bookmarked = state.projects
    .filter((project) => project.closed !== true && positions.has(project.projectId) && matchesQuery(project))
    .sort((left, right) => (positions.get(left.projectId) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.projectId) ?? Number.MAX_SAFE_INTEGER));
  const other = state.projects
    .filter((project) => !positions.has(project.projectId) && matchesQuery(project))
    .sort(compareProjects);
  const hasResults = bookmarked.length + other.length > 0;
  const setClosed = (projectId: ProjectId, value: boolean): void => {
    setProjectSaving(projectId);
    setProjectError(undefined);
    void onSetProjectClosed(projectId, value)
      .catch((reason: unknown) => setProjectError(reason instanceof Error ? reason.message : "Project state could not be changed"))
      .finally(() => setProjectSaving(undefined));
  };
  const changeMembership = (projectId: ProjectId, member: boolean): void => {
    const action = member ? onRemoveFromWorkspace : onOpenInWorkspace;
    if (action === undefined) return;
    setProjectSaving(projectId);
    setProjectError(undefined);
    void action(projectId)
      .catch((reason: unknown) => setProjectError(reason instanceof Error ? reason.message : "Workspace membership could not be changed"))
      .finally(() => setProjectSaving(undefined));
  };

  return (
    <main className="projects-index projects-index-page">
      <div className="projects-page-shell">
        <header className="projects-page-header">
          <div className="projects-page-heading">
            <h1>Projects</h1>
            <p>Find and manage your Project working directories.</p>
          </div>
          <div className="projects-page-header-actions">
            <Button type="button" onClick={onAdd}><Plus data-icon="inline-start" aria-hidden="true" />Add Project</Button>
          </div>
          <MobileNavigationMenu current="projects" onNewSession={onNewSession} onNewProject={onAdd} onDashboard={onDashboard} onProjects={onProjects} onSettings={onSettings} />
        </header>

        {state.projects.length === 0 ? (
          <div className="projects-page-empty">
            <Folder aria-hidden="true" size={22} />
            <h2>No Projects yet.</h2>
            <p>Add a Project to give Pi a working directory.</p>
            <Button type="button" onClick={onAdd}>Add Project</Button>
          </div>
        ) : (
          <div className="projects-page-content">
            <div className="projects-page-toolbar">
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Projects" aria-label="Search Projects" />
            </div>
            {hasResults ? (
              <>
                {bookmarked.length > 0 && <ProjectGroup title="Bookmarked" projects={bookmarked} onOpen={onOpen} saving={saving} workspaceProjectIds={workspaceProjectIds} onChangeMembership={changeMembership} onReorder={(projectId, direction) => {
                  const requestId = onReorderBookmark(projectId, direction);
                  if (requestId !== undefined) setMutationRequestId(requestId);
                }} {...(projectSaving === undefined ? {} : { projectSaving })} />}
                {other.length > 0 && <ProjectGroup title="Other Projects" projects={other} onOpen={onOpen} saving={saving} workspaceProjectIds={workspaceProjectIds} onChangeMembership={changeMembership} {...(projectSaving === undefined ? {} : { projectSaving })} onSetClosed={setClosed} />}
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

const compareProjects = (left: ApplicationState["projects"][number], right: ApplicationState["projects"][number]): number => (
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.projectId.localeCompare(right.projectId)
);

function ProjectGroup({ title, projects, onOpen, saving, onReorder, projectSaving, onSetClosed, workspaceProjectIds, onChangeMembership }: {
  title: string;
  projects: ApplicationState["projects"];
  onOpen: (projectId: ProjectId) => void;
  saving: boolean;
  onReorder?: (projectId: ProjectId, direction: "up" | "down") => void;
  projectSaving?: ProjectId;
  onSetClosed?: (projectId: ProjectId, closed: boolean) => void;
  workspaceProjectIds: ReadonlySet<ProjectId>;
  onChangeMembership?: ((projectId: ProjectId, member: boolean) => void) | undefined;
}) {
  const headingId = `projects-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section className="projects-page-group" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}<span aria-hidden="true">{projects.length}</span></h2>
      <Card className="projects-page-list bg-transparent" role="list">
        {projects.map((project, index) => (
          <div className={`projects-page-row${project.available ? "" : " unavailable"}`} key={project.projectId} role="listitem">
            <div className="projects-page-row-open" {...(workspaceProjectIds.has(project.projectId) ? {
              role: "button", tabIndex: 0, "aria-label": `${project.closed === true ? "View" : "Open"} ${project.name}`,
              onClick: () => onOpen(project.projectId),
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpen(project.projectId);
              },
            } : {})}>
              <span className="projects-page-row-icon"><Folder aria-hidden="true" size={18} /></span>
              <div className="projects-page-row-copy"><h3>{project.name}</h3><span title={project.displayPath}>{project.displayPath}</span></div>
            </div>
            <div className="projects-page-row-status">{project.available ? <Badge variant="outline">Available</Badge> : <Badge variant="outline">Unavailable</Badge>}</div>
            <div className="projects-page-row-actions">
              {onChangeMembership !== undefined && <Button type="button" variant="outline" disabled={projectSaving !== undefined} onClick={() => onChangeMembership(project.projectId, workspaceProjectIds.has(project.projectId))}>
                {projectSaving === project.projectId ? "Saving…" : workspaceProjectIds.has(project.projectId) ? "Remove from Workspace" : "Move to this Workspace"}
              </Button>}
              {workspaceProjectIds.has(project.projectId) && project.closed === true && onSetClosed !== undefined && <Button type="button" variant="outline" disabled={projectSaving !== undefined} onClick={() => onSetClosed(project.projectId, false)}>{projectSaving === project.projectId ? "Opening…" : "Open Project"}</Button>}
              {onReorder !== undefined && <span className="projects-page-order" role="group" aria-label={`Change ${project.name} order`}>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${project.name} up`} disabled={saving || index === 0} onClick={() => onReorder(project.projectId, "up")}><ArrowUp aria-hidden="true" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${project.name} down`} disabled={saving || index === projects.length - 1} onClick={() => onReorder(project.projectId, "down")}><ArrowDown aria-hidden="true" /></Button>
              </span>}
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
