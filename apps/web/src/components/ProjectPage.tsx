import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkMinus,
  ChevronDown,
  Folder,
  Plus,
  Search,
} from "lucide-react";
import type { ProjectSummary, SessionKey, SessionSummary } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import type { ApplicationClient } from "../application/application-client";
import { ScheduledJobs } from "./ScheduledJobs";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function ProjectPage({
  state,
  client,
  project,
  onBack,
  onNewSession,
  onOpenSession,
  onSetProjectBookmark,
  onRemoveProject,
  onSetProjectClosed = () => Promise.reject(new Error("Project state changes are unavailable")),
  onRemoved,
  onSetSessionBookmark,
  onReorderSessionBookmark,
  onCloseSessions,
  developmentServer,
  onConfigureDevelopmentServer,
}: {
  state: ApplicationState;
  client?: ApplicationClient | undefined;
  project: ProjectSummary;
  onBack: () => void;
  onNewSession: () => void;
  onOpenSession: (key: SessionKey) => void;
  onSetProjectBookmark: (bookmarked: boolean) => string | undefined;
  onRemoveProject: () => string | undefined;
  onSetProjectClosed?: (closed: boolean) => Promise<void>;
  onRemoved: () => void;
  onSetSessionBookmark: (key: SessionKey, bookmarked: boolean) => string | undefined;
  onReorderSessionBookmark: (key: SessionKey, direction: "up" | "down") => string | undefined;
  onCloseSessions?: (keys: readonly SessionKey[]) => void;
  developmentServer?: ApplicationState["developmentServers"][number];
  onConfigureDevelopmentServer: (configuration?: { command: string; previewPort?: number }) => string | undefined;
}) {
  const [view, setView] = useState<"sessions" | "scheduled-jobs" | "settings">("sessions");
  const [sessionQuery, setSessionQuery] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [mutationRequestId, setMutationRequestId] = useState<string>();
  const [serverRequestId, setServerRequestId] = useState<string>();
  const [removalRequestId, setRemovalRequestId] = useState<string>();
  const [savingProjectState, setSavingProjectState] = useState(false);
  const [projectStateError, setProjectStateError] = useState<string>();
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [command, setCommand] = useState(developmentServer?.configuration?.command ?? "");
  const [previewPort, setPreviewPort] = useState(developmentServer?.configuration?.previewPort?.toString() ?? "");
  const mutation = mutationRequestId === undefined
    ? undefined
    : state.bookmarkMutations[mutationRequestId];
  const saving = mutation?.status === "saving";
  const removal = removalRequestId === undefined ? undefined : state.projectRemovals[removalRequestId];
  const removing = removal?.status === "saving";
  const serverRequest = serverRequestId === undefined ? undefined : state.developmentServerRequests[serverRequestId];
  const serverSaving = serverRequest?.status === "loading";
  const serverError = serverRequest?.result?.status === "rejected"
    || serverRequest?.result?.status === "retryable"
    ? serverRequest.result.error.message
    : undefined;
  const mutationError = mutation?.result?.status === "rejected"
    || mutation?.result?.status === "retryable"
    ? mutation.result.error.message
    : undefined;
  const projectBookmarked = state.projectBookmarks.some(
    (bookmark) => bookmark.projectId === project.projectId,
  );
  const sessions = state.sessions
    .filter((session) => session.projectId === project.projectId)
    .sort((left, right) => sessionTime(right) - sessionTime(left));
  const bookmarkPositions = new Map(
    state.sessionBookmarks
      .filter((bookmark) => bookmark.projectId === project.projectId)
      .map((bookmark) => [
        bookmark.sessionKey.piSessionId,
        bookmark.position,
      ]),
  );
  const bookmarked = sessions
    .filter((session) => bookmarkPositions.has(sessionId(session)))
    .sort((left, right) => (
      (bookmarkPositions.get(sessionId(left)) ?? Number.MAX_SAFE_INTEGER)
      - (bookmarkPositions.get(sessionId(right)) ?? Number.MAX_SAFE_INTEGER)
    ));
  const bookmarkedIds = new Set(bookmarked.map(sessionId));
  const running = sessions.filter((session) => (
    session.projection.availability === "available"
      || session.projection.availability === "reconnecting"
  ) && !bookmarkedIds.has(sessionId(session)));
  const closed = sessions.filter((session) => (
    session.projection.availability !== "available"
      && session.projection.availability !== "reconnecting"
  ) && !bookmarkedIds.has(sessionId(session)));
  const closable = sessions.filter((session) => (
    (session.projection.availability === "available"
      || session.projection.availability === "reconnecting")
    && session.projection.capabilities.includes("session.close")
  ));
  const workingCount = closable.filter((session) => session.projection.run === "working").length;
  const sessionMatchesQuery = (session: SessionSummary): boolean => {
    const search = sessionQuery.trim().toLocaleLowerCase();
    return search.length === 0 || (session.name || "Untitled Session").toLocaleLowerCase().includes(search);
  };
  const visibleBookmarked = bookmarked.filter(sessionMatchesQuery);
  const visibleRunning = running.filter(sessionMatchesQuery);
  const visibleClosed = closed.filter(sessionMatchesQuery);

  useEffect(() => {
    if (mutation?.status === "succeeded") setMutationRequestId(undefined);
  }, [mutation?.status]);

  useEffect(() => {
    if (removal?.status === "succeeded") onRemoved();
  }, [removal?.status, onRemoved]);

  useEffect(() => {
    setView("sessions");
    setSessionQuery("");
    setEditingName(false);
    setName(project.name);
    setNameError("");
    setCommand(developmentServer?.configuration?.command ?? "");
    setPreviewPort(developmentServer?.configuration?.previewPort?.toString() ?? "");
    setServerRequestId(undefined);
    setClosedOpen(false);
  }, [project.projectId, developmentServer?.configuration?.command, developmentServer?.configuration?.previewPort]);

  useEffect(() => {
    if (closed.length === 0) setClosedOpen(false);
  }, [closed.length]);

  const track = (requestId: string | undefined): void => {
    if (requestId !== undefined) setMutationRequestId(requestId);
  };

  return (
    <main className="project-page-view">
      <div className="project-page-shell">
        <header className="project-page-header">
          <nav aria-label="Breadcrumb">
            <ol className="project-page-breadcrumb">
              <li>
                <a
                  className="project-page-breadcrumb-link"
                  href="#projects"
                  onClick={(event) => {
                    event.preventDefault();
                    onBack();
                  }}
                >
                  Projects
                </a>
              </li>
              <li aria-current="page">{project.name}</li>
            </ol>
          </nav>
        </header>

        <section className="project-page-hero-view" aria-labelledby="project-page-title">
          <div className="project-page-hero-copy">
            <div className="project-page-title-row">
              <span className="project-page-hero-icon">
                <Folder aria-hidden="true" size={20} />
              </span>
              <h1 id="project-page-title">{project.name}</h1>
              {!project.available && <Badge variant="outline">Unavailable</Badge>}
            </div>
            <p className="project-page-hero-path" title={project.displayPath}>{project.displayPath}</p>
          </div>
          <div className="project-page-hero-actions">
            <Button
              type="button"
              size="lg"
              className="project-page-new-session"
              onClick={onNewSession}
              disabled={!project.available}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              New Session
            </Button>

          </div>
        </section>

        <Tabs
          className="project-page-tabs"
          value={view}
          onValueChange={(value) => {
            if (value === "sessions") setView("sessions");
            else if (value === "scheduled-jobs") setView("scheduled-jobs");
            else if (value === "settings") setView("settings");
          }}
        >
          <TabsList className="project-page-tabs-list" variant="line" aria-label={`${project.name} sections`}>
            <TabsTrigger value="sessions">Previous Sessions</TabsTrigger>
            <TabsTrigger value="scheduled-jobs">Scheduled Jobs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="sessions" className="project-page-tab-content">
            <section className="project-page-section project-sessions-section" aria-label="Previous Sessions">
              <div className="project-sessions-heading">
                <div><h2>Previous Sessions</h2><p>Open a recent Session or start a new one.</p></div>
                <div className="project-session-search">
                  <Search aria-hidden="true" />
                  <Input value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} placeholder="Search Previous Sessions" aria-label="Search Previous Sessions" />
                </div>
              </div>
              <div className="project-sessions-toolbar">
                <AlertDialog open={confirmCloseAll} onOpenChange={setConfirmCloseAll}>
                  <AlertDialogTrigger
                    disabled={closable.length === 0 || onCloseSessions === undefined}
                    render={<Button type="button" variant="ghost" className="project-close-all-button text-destructive hover:text-destructive" />}
                  >
                    Close all Sessions
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Close {closable.length} {closable.length === 1 ? "Session" : "Sessions"}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This closes all open Sessions in {project.name}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="project-alert-dialog-copy">
                      <p>The saved conversations will remain available.</p>
                      {workingCount > 0 && (
                        <p><strong>{workingCount} working {workingCount === 1 ? "Session" : "Sessions"} will stop.</strong></p>
                      )}
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          onCloseSessions?.(closable.map((session) => session.sessionKey));
                          setConfirmCloseAll(false);
                        }}
                      >
                        Close all Sessions
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {visibleBookmarked.length > 0 && (
                <SessionGroup
                  title="Bookmarked"
                  sessions={visibleBookmarked}
                  onOpen={onOpenSession}
                  bookmarked
                  saving={saving}
                  onBookmark={(session, value) => track(
                    onSetSessionBookmark(session.sessionKey, value),
                  )}
                  onReorder={(session, direction) => track(
                    onReorderSessionBookmark(session.sessionKey, direction),
                  )}
                />
              )}
              <SessionGroup
                title="Open"
                sessions={visibleRunning}
                empty={sessionQuery.trim() === "" ? "No Sessions are open in this Project." : "No matching open Sessions."}
                onOpen={onOpenSession}
                saving={saving}
                onBookmark={(session, value) => track(
                  onSetSessionBookmark(session.sessionKey, value),
                )}
                onReorder={(session, direction) => track(
                  onReorderSessionBookmark(session.sessionKey, direction),
                )}
              />
              {visibleClosed.length > 0 && (
                <ClosedSessionGroup
                  sessions={visibleClosed}
                  open={closedOpen}
                  onOpenChange={setClosedOpen}
                  saving={saving}
                  onOpenSession={onOpenSession}
                  onBookmark={(session, value) => track(
                    onSetSessionBookmark(session.sessionKey, value),
                  )}
                />
              )}
            </section>
          </TabsContent>

          <TabsContent value="scheduled-jobs" className="project-page-tab-content project-scheduled-jobs-tab">
            <ScheduledJobs
              client={client}
              projectId={String(project.projectId)}
              sessions={running}
            />
          </TabsContent>

          <TabsContent value="settings" className="project-page-tab-content">
            <section className="project-page-section project-settings-section" aria-labelledby="project-settings-heading">
              <h2 id="project-settings-heading">Settings</h2>
              <div className="project-settings-cards">
                <Card className="project-settings-card gap-0 bg-transparent py-0">
                  <CardHeader>
                    <CardTitle><h3>Project details</h3></CardTitle>
                    <CardDescription>Change the Project name without changing its directory.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="project-settings-details">
                      <div className="project-name-setting">
                        <dt>Name</dt>
                        <dd>
                          {editingName ? (
                            <form onSubmit={(event) => {
                              event.preventDefault();
                              const next = name.trim();
                              if (next === "" || next === project.name || client === undefined) return;
                              setNameSaving(true);
                              setNameError("");
                              void client.renameProject(project.projectId, next)
                                .then(() => setEditingName(false))
                                .catch((reason: unknown) => setNameError(reason instanceof Error ? reason.message : "Project name could not be saved"))
                                .finally(() => setNameSaving(false));
                            }}>
                              <Label className="sr-only" htmlFor="project-name-input">Project name</Label>
                              <Input id="project-name-input" value={name} maxLength={120} autoFocus disabled={nameSaving} onChange={(event) => setName(event.target.value)} />
                              <span>
                                <Button type="button" variant="outline" disabled={nameSaving} onClick={() => { setEditingName(false); setName(project.name); setNameError(""); }}>Cancel</Button>
                                <Button type="submit" disabled={nameSaving || name.trim() === "" || name.trim() === project.name}>{nameSaving ? "Saving…" : "Save"}</Button>
                              </span>
                            </form>
                          ) : (
                            <span className="project-name-value">
                              <span>{project.name}</span>
                              <Button type="button" variant="outline" disabled={client === undefined} onClick={() => { setName(project.name); setEditingName(true); }}>Edit</Button>
                            </span>
                          )}
                          {nameError !== "" && <small role="alert">{nameError}</small>}
                        </dd>
                      </div>
                      <div>
                        <dt>Directory</dt>
                        <dd>{project.displayPath}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>

                <Card className="project-settings-card gap-0 bg-transparent py-0">
                  <CardHeader>
                    <CardTitle><h3>Development Server</h3></CardTitle>
                    <CardDescription>Run and preview this Project during development.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="project-development-server-form" onSubmit={(event) => {
                      event.preventDefault();
                      const trimmed = command.trim();
                      if (trimmed === "") return;
                      const port = previewPort === "" ? undefined : Number(previewPort);
                      const requestId = onConfigureDevelopmentServer({
                        command: trimmed,
                        ...(port === undefined ? {} : { previewPort: port }),
                      });
                      if (requestId !== undefined) setServerRequestId(requestId);
                    }}>
                      <div className="project-development-server-field">
                        <Label htmlFor="development-server-command">Command</Label>
                        <Input id="development-server-command" value={command} maxLength={4096} placeholder="npm run dev" disabled={developmentServer?.lifecycle === "running" || serverSaving} onChange={(event) => setCommand(event.target.value)} />
                        <small>Pi Station runs this command from the Project directory without shell operators.</small>
                      </div>
                      <div className="project-development-server-field">
                        <Label htmlFor="development-server-preview-port">Preview port <span className="project-field-optional">Optional</span></Label>
                        <Input id="development-server-preview-port" type="number" min={1} max={65535} value={previewPort} placeholder="3000" disabled={developmentServer?.lifecycle === "running" || serverSaving} onChange={(event) => setPreviewPort(event.target.value)} />
                        <small>Pi Station uses this port for the Open preview button.</small>
                      </div>
                      <div className="project-form-actions">
                        {developmentServer?.configuration !== undefined && (
                          <Button type="button" variant="outline" disabled={developmentServer.lifecycle === "running" || serverSaving} onClick={() => {
                            const requestId = onConfigureDevelopmentServer();
                            if (requestId !== undefined) setServerRequestId(requestId);
                            setCommand("");
                            setPreviewPort("");
                          }}>Remove configuration</Button>
                        )}
                        <Button type="submit" disabled={command.trim() === "" || developmentServer?.lifecycle === "running" || serverSaving}>Save Development Server</Button>
                      </div>
                      {serverRequest?.status === "succeeded" && <p role="status">Development Server configuration saved.</p>}
                      {serverError && <p className="new-session-error" role="alert">{serverError}</p>}
                    </form>
                  </CardContent>
                </Card>

                <Card className="project-settings-card gap-0 bg-transparent py-0">
                  <CardHeader>
                    <CardTitle><h3>Project availability</h3></CardTitle>
                    <CardDescription>Hide this Project from active views without removing it.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={savingProjectState}
                      onClick={() => {
                        setSavingProjectState(true);
                        setProjectStateError(undefined);
                        void onSetProjectClosed(project.closed !== true)
                          .catch((reason: unknown) => setProjectStateError(reason instanceof Error ? reason.message : "Project state could not be changed"))
                          .finally(() => setSavingProjectState(false));
                      }}
                    >
                      {savingProjectState ? (project.closed === true ? "Opening…" : "Closing…") : (project.closed === true ? "Open Project" : "Close Project")}
                    </Button>
                    {projectStateError && <p className="new-session-error" role="alert">{projectStateError}</p>}
                  </CardContent>
                </Card>

                <Card className="project-settings-card gap-0 bg-transparent py-0">
                  <CardHeader>
                    <CardTitle><h3>Project Bookmark</h3></CardTitle>
                    <CardDescription>Keep this Project available in your bookmarked Project list.</CardDescription>
                  </CardHeader>
                  <CardContent className="project-bookmark-card-content">
                    <Button
                      className="project-bookmark-control"
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => track(onSetProjectBookmark(!projectBookmarked))}
                    >
                      {projectBookmarked ? "Remove Project Bookmark" : "Bookmark Project"}
                    </Button>
                    {mutationError && (
                      <p className="new-session-error" role="alert">{mutationError}</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="project-settings-card project-removal-card gap-0 bg-transparent py-0">
                  <CardHeader>
                    <CardTitle><h3>Remove Project</h3></CardTitle>
                    <CardDescription>This removes the Project from Pi Station only. It does not delete or change the Project directory, files, or Pi Session history.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AlertDialog open={confirmRemoval} onOpenChange={setConfirmRemoval}>
                      <AlertDialogTrigger render={<Button type="button" variant="ghost" className="text-destructive hover:text-destructive" />}>Remove Project from Pi Station</AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Confirm removal.</AlertDialogTitle>
                          <AlertDialogDescription>
                            Open Sessions will leave Pi Station views. Working Sessions can finish safely. Pi Station will not stop any Pi process.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={removing}
                            onClick={() => {
                              const requestId = onRemoveProject();
                              if (requestId !== undefined) setRemovalRequestId(requestId);
                            }}
                          >
                            {removing ? "Removing…" : "Confirm: Remove Project from Pi Station"}
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {removal?.status === "failed" && <p className="new-session-error" role="alert">{removal.error}</p>}
                  </CardContent>
                </Card>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function SessionGroup({
  title,
  sessions,
  empty,
  onOpen,
  bookmarked = false,
  saving,
  onBookmark,
  onReorder,
}: {
  title: string;
  sessions: readonly SessionSummary[];
  empty?: string;
  onOpen: (key: SessionKey) => void;
  bookmarked?: boolean;
  saving: boolean;
  onBookmark: (session: SessionSummary, bookmarked: boolean) => void;
  onReorder: (session: SessionSummary, direction: "up" | "down") => void;
}) {
  const headingId = `project-${title.toLowerCase()}-sessions-heading`;
  return (
    <section className="project-session-group-view" aria-labelledby={headingId}>
      <Card className="project-session-card gap-0 bg-transparent py-0">
        <CardHeader className="project-session-card-header">
          <CardTitle className="project-session-card-title"><h3 id={headingId}>{title}</h3></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sessions.length > 0 ? (
            <div className="project-session-list-view">
              {sessions.map((session, index) => (
                <SessionRow
                  key={sessionId(session)}
                  session={session}
                  onOpen={onOpen}
                  bookmarked={bookmarked}
                  saving={saving}
                  onBookmark={(value) => onBookmark(session, value)}
                  {...(bookmarked && index > 0
                    ? { onMoveUp: () => onReorder(session, "up") }
                    : {})}
                  {...(bookmarked && index < sessions.length - 1
                    ? { onMoveDown: () => onReorder(session, "down") }
                    : {})}
                />
              ))}
            </div>
          ) : empty ? <p>{empty}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}

function ClosedSessionGroup({
  sessions,
  open,
  onOpenChange,
  saving,
  onOpenSession,
  onBookmark,
}: {
  sessions: readonly SessionSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onOpenSession: (key: SessionKey) => void;
  onBookmark: (session: SessionSummary, bookmarked: boolean) => void;
}) {
  const headingId = "project-closed-sessions-heading";
  return (
    <section className="project-session-group-view" aria-labelledby={headingId}>
      <Card className="project-session-card project-closed-sessions-card gap-0 bg-transparent py-0">
        <Collapsible className="project-closed-sessions-collapsible" open={open} onOpenChange={onOpenChange}>
          <CardHeader className="project-session-card-header project-closed-sessions-header">
            <CardTitle className="project-session-card-title">
              <h3 id={headingId}>Closed Sessions</h3>
              <Badge variant="outline">{sessions.length}</Badge>
            </CardTitle>
            <CollapsibleTrigger
              className="project-closed-sessions-trigger"
              aria-label={`${open ? "Hide" : "Show"} Closed Sessions`}
              render={<Button type="button" variant="ghost" size="icon-lg" />}
            >
              <ChevronDown aria-hidden="true" size={18} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent className="project-closed-sessions-content">
            <CardContent className="p-0">
              <div className="project-session-list-view">
                {sessions.map((session) => (
                  <SessionRow
                    key={sessionId(session)}
                    session={session}
                    onOpen={onOpenSession}
                    saving={saving}
                    onBookmark={(value) => onBookmark(session, value)}
                  />
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </section>
  );
}

function SessionRow({
  session,
  onOpen,
  bookmarked = false,
  saving,
  onBookmark,
  onMoveUp,
  onMoveDown,
}: {
  session: SessionSummary;
  onOpen: (key: SessionKey) => void;
  bookmarked?: boolean;
  saving: boolean;
  onBookmark: (bookmarked: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const available = session.projection.availability === "available";
  const reconnecting = session.projection.availability === "reconnecting";
  const closed = session.projection.availability === "closed";
  const openable = available || reconnecting || closed;
  const label = session.name || "Untitled Session";
  const status = reconnecting
    ? "Reconnecting"
    : available
      ? session.projection.run === "working" ? "Working" : "Idle"
      : "Closed";
  return (
    <div className="project-session-row-view">
      <Button
        className="project-session-open-view"
        variant="ghost"
        type="button"
        disabled={!openable}
        onClick={() => onOpen(session.sessionKey)}
        title={reconnecting
          ? "Session is reconnecting"
          : available
            ? ""
            : closed
              ? "View closed Session read-only"
              : "Session open is not available"}
      >
        <span className="project-session-open-copy">
          <span className="project-session-name">
            <i className={session.projection.run === "working" ? "working" : ""} aria-hidden="true" />
            <strong>{label}</strong>
          </span>
          <Badge variant="outline" className="project-session-state">{status}</Badge>
        </span>
      </Button>
      <div className="project-session-bookmark-actions" role="group" aria-label={`Bookmark controls for ${label}`}>
        {bookmarked && (
          <>
            <Button className="project-session-action-button" type="button" variant="ghost" size="icon-lg" aria-label={`Move ${label} up`} disabled={saving || onMoveUp === undefined} onClick={onMoveUp}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button className="project-session-action-button" type="button" variant="ghost" size="icon-lg" aria-label={`Move ${label} down`} disabled={saving || onMoveDown === undefined} onClick={onMoveDown}>
              <ArrowDown aria-hidden="true" />
            </Button>
          </>
        )}
        <Button
          className="project-session-action-button"
          type="button"
          variant="ghost"
          size="icon-lg"
          disabled={saving}
          aria-label={bookmarked ? `Remove ${label} Bookmark` : `Bookmark ${label}`}
          onClick={() => onBookmark(!bookmarked)}
        >
          {bookmarked ? <BookmarkMinus aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function sessionTime(session: SessionSummary): number {
  const parsed = Date.parse(session.lastActivityAt ?? session.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionId(session: SessionSummary): string {
  return session.sessionKey.piSessionId;
}
