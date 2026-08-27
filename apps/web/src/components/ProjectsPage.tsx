import { useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Folder, Plus } from "lucide-react";
import type { ProjectId } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { MobileNavigationMenu } from "./MobileNavigationMenu";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

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
}: {
  state: ApplicationState;
  onOpen: (projectId: ProjectId) => void;
  onAdd: () => void;
  onNewSession: () => void;
  onDashboard: () => void;
  onProjects: () => void;
  onSettings: () => void;
  onReorderBookmark: (
    projectId: ProjectId,
    direction: "up" | "down",
  ) => string | undefined;
  onSetProjectClosed?: (projectId: ProjectId, closed: boolean) => Promise<void>;
}) {
  const [mutationRequestId, setMutationRequestId] = useState<string>();
  const [projectSaving, setProjectSaving] = useState<ProjectId>();
  const [projectError, setProjectError] = useState<string>();
  const mutation = mutationRequestId === undefined
    ? undefined
    : state.bookmarkMutations[mutationRequestId];
  const saving = mutation?.status === "saving";
  const error = mutation?.result?.status === "rejected"
    || mutation?.result?.status === "retryable"
    ? mutation.result.error.message
    : undefined;
  const positions = new Map(
    state.projectBookmarks.map((bookmark) => [
      bookmark.projectId,
      bookmark.position,
    ]),
  );
  const bookmarked = state.projects
    .filter((project) => project.closed !== true && positions.has(project.projectId))
    .sort((left, right) => (
      (positions.get(left.projectId) ?? Number.MAX_SAFE_INTEGER)
      - (positions.get(right.projectId) ?? Number.MAX_SAFE_INTEGER)
    ));
  const other = state.projects
    .filter((project) => project.closed !== true && !positions.has(project.projectId))
    .sort(compareProjects);
  const closed = state.projects
    .filter((project) => project.closed === true)
    .sort(compareProjects);
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
            <p>Open and organize your Projects.</p>
          </div>
          <div className="projects-page-header-actions">
            <Button type="button" onClick={onAdd}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add Project
            </Button>
          </div>
          <MobileNavigationMenu
            current="projects"
            onNewSession={onNewSession}
            onNewProject={onAdd}
            onDashboard={onDashboard}
            onProjects={onProjects}
            onSettings={onSettings}
          />
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
            {bookmarked.length > 0 && (
              <ProjectGroup
                title="Bookmarked"
                projects={bookmarked}
                onOpen={onOpen}
                saving={saving}
                onReorder={(projectId, direction) => {
                  const requestId = onReorderBookmark(projectId, direction);
                  if (requestId !== undefined) setMutationRequestId(requestId);
                }}
              />
            )}
            {other.length > 0 && (
              <ProjectGroup
                title="Other Projects"
                projects={other}
                onOpen={onOpen}
                saving={saving}
              />
            )}
            {closed.length > 0 && (
              <ProjectGroup
                title="Closed Projects"
                projects={closed}
                onOpen={onOpen}
                saving={saving}
                closed
                {...(projectSaving === undefined ? {} : { projectSaving })}
                onSetClosed={setClosed}
              />
            )}
            {(error ?? projectError) && <p className="new-session-error" role="alert">{error ?? projectError}</p>}
          </div>
        )}
      </div>
    </main>
  );
}

const compareProjects = (left: ApplicationState["projects"][number], right: ApplicationState["projects"][number]): number => (
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  || left.projectId.localeCompare(right.projectId)
);

function ProjectGroup({
  title,
  projects,
  onOpen,
  saving,
  onReorder,
  closed = false,
  projectSaving,
  onSetClosed,
}: {
  title: string;
  projects: ApplicationState["projects"];
  onOpen: (projectId: ProjectId) => void;
  saving: boolean;
  onReorder?: (projectId: ProjectId, direction: "up" | "down") => void;
  closed?: boolean;
  projectSaving?: ProjectId;
  onSetClosed?: (projectId: ProjectId, closed: boolean) => void;
}) {
  const headingId = `projects-${title.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <section className="projects-page-group" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <div className="projects-page-grid" role="list">
        {projects.map((project, index) => (
          <Card
            className={`projects-page-card bg-transparent${project.available ? "" : " unavailable"}`}
            key={project.projectId}
            role="listitem"
          >
            <CardHeader
              className={`projects-page-card-header${closed ? "" : " projects-page-card-open"}`}
              {...(closed ? {} : {
                role: "button",
                tabIndex: 0,
                "aria-label": `Open ${project.name}`,
                onClick: () => onOpen(project.projectId),
                onKeyDown: (event: KeyboardEvent) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpen(project.projectId);
                },
              })}
            >
              <span className="projects-page-card-icon">
                <Folder aria-hidden="true" size={19} />
              </span>
              <div className="projects-page-card-copy">
                <CardTitle><h3>{project.name}</h3></CardTitle>
                <CardDescription className="projects-page-card-path" title={project.displayPath}>
                  {project.displayPath}
                </CardDescription>
              </div>
              {!project.available && <Badge variant="outline">Unavailable</Badge>}
            </CardHeader>
            {closed && onSetClosed !== undefined && (
              <CardFooter className="projects-page-card-footer border-foreground/10 bg-transparent">
                <Button
                  type="button"
                  variant="outline"
                  disabled={projectSaving !== undefined}
                  onClick={() => onSetClosed(project.projectId, false)}
                >
                  {projectSaving === project.projectId ? "Opening…" : "Open Project"}
                </Button>
              </CardFooter>
            )}
            {onReorder !== undefined && (
              <CardFooter
                className="projects-page-card-footer border-foreground/10 bg-transparent"
                role="group"
                aria-label={`Change ${project.name} order`}
              >
                <span className="projects-page-order">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${project.name} up`}
                    disabled={saving || index === 0}
                    onClick={() => onReorder(project.projectId, "up")}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${project.name} down`}
                    disabled={saving || index === projects.length - 1}
                    onClick={() => onReorder(project.projectId, "down")}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </span>
              </CardFooter>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
