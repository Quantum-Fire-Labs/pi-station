import { useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, FileText, X } from "lucide-react";
import type { ProjectSummary, SessionSummary } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";

export function SessionDetails({
  state,
  summary,
  project,
  bookmarked,
  bookmarkSaving,
  bookmarkError,
  canCloseSession,
  canCloneSession,
  canReloadSession,
  canRestartSession,
  restartSaving,
  restartError,
  canRenameSession,
  settingSaving,
  reloadSaving,
  reloadError,
  onClose,
  onRequestCloseSession,
  onCloneSession,
  onReloadSession,
  onRestartSession,
  onRenameSession,
  onOpenProject,
  onNewSession,
  projects,
  onMoveSession,
  onCancelMove,
  onSetBookmark,
  developmentServer,
  developmentServerOutput,
  developmentServerPending,
  developmentServerError,
  onStartDevelopmentServer,
  onStopDevelopmentServer,
  onViewDevelopmentServerOutput,
  onOpenSharedMarkdown,
}: {
  state: ApplicationState;
  summary: SessionSummary;
  project?: ProjectSummary;
  bookmarked: boolean;
  bookmarkSaving: boolean;
  bookmarkError?: string;
  canCloseSession: boolean;
  canCloneSession: boolean;
  canReloadSession: boolean;
  canRestartSession: boolean;
  restartSaving: boolean;
  restartError?: string;
  canRenameSession: boolean;
  settingSaving: boolean;
  reloadSaving: boolean;
  reloadError?: string;
  onClose: () => void;
  onRequestCloseSession: () => void;
  onCloneSession: () => void;
  onReloadSession: () => void;
  onRestartSession: () => void;
  onRenameSession: (name: string) => void;
  onOpenProject: () => void;
  onNewSession: () => void;
  projects: readonly ProjectSummary[];
  onMoveSession: (projectId: string) => void;
  onCancelMove: () => void;
  onSetBookmark: (bookmarked: boolean) => void;
  developmentServer?: ApplicationState["developmentServers"][number];
  developmentServerOutput?: string;
  developmentServerPending: boolean;
  developmentServerError?: string;
  onStartDevelopmentServer: () => void;
  onStopDevelopmentServer: () => void;
  onViewDevelopmentServerOutput: () => void;
  onOpenSharedMarkdown: (file: { name: string; url: string }) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [moveProjectId, setMoveProjectId] = useState(summary.projectId ?? "");
  const details = state.selected.details;
  const projection = state.selected.projection ?? summary.projection;
  const name = details?.name ?? summary.name ?? "Untitled Session";
  const directory = details?.currentDirectoryDisplay ?? summary.displayPath ?? "Unavailable";
  const status = projection.availability === "available"
    ? titleCase(projection.run)
    : titleCase(projection.availability);
  const management = projection.management.kind === "managed"
    ? `${titleCase(projection.management.processState)} · ${projection.management.runner}`
    : "Unmanaged";
  const updated = summary.lastActivityAt === undefined
    ? "Unavailable"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(summary.lastActivityAt));

  return (
    <aside className="session-details" aria-labelledby="session-details-title">
      <header>
        <div>
          <span className={`session-details-dot${projection.run === "working" ? " working" : ""}`} />
          <span>{status}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Session details">
          <X className="details-close-desktop" aria-hidden="true" size={18} />
          <ArrowLeft className="details-close-mobile" aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="session-details-content">
        <section className="session-details-overview">
          <div className="session-details-name">
            <h1 id="session-details-title">{name}</h1>
            {canRenameSession && !editingName && (
              <button
                type="button"
                disabled={settingSaving}
                onClick={() => {
                  setNameDraft(name);
                  setEditingName(true);
                }}
              >Rename</button>
            )}
          </div>
          {editingName && (
            <form
              className="session-setting-form"
              onSubmit={(event) => {
                event.preventDefault();
                const value = nameDraft.trim();
                if (value === "") return;
                onRenameSession(value);
                setEditingName(false);
              }}
            >
              <label><span>Session name</span><input value={nameDraft} maxLength={120} autoFocus onChange={(event) => setNameDraft(event.target.value)} /></label>
              <div><button type="button" onClick={() => setEditingName(false)}>Cancel</button><button type="submit" disabled={nameDraft.trim() === "" || settingSaving}>Save</button></div>
            </form>
          )}
          <p>{directory}</p>
        </section>

        <dl className="session-details-facts">
          <div className="wide">
            <dt>Session ID</dt>
            <dd className="session-details-id">
              <span>{summary.sessionKey.piSessionId}</span>
              <button
                type="button"
                aria-label={copyState === "copied" ? "Session ID copied" : "Copy Session ID"}
                title={copyState === "copied" ? "Session ID copied" : "Copy Session ID"}
                onClick={() => {
                  if (navigator.clipboard === undefined) {
                    setCopyState("failed");
                    return;
                  }
                  void navigator.clipboard.writeText(summary.sessionKey.piSessionId)
                    .then(() => setCopyState("copied"))
                    .catch(() => setCopyState("failed"));
                }}
              >
                {copyState === "copied"
                  ? <Check aria-hidden="true" size={14} />
                  : <Copy aria-hidden="true" size={14} />}
              </button>
            </dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>
              {project === undefined
                ? "Unavailable"
                : <button className="session-details-project-link" type="button" onClick={onOpenProject}>{project.name}</button>}
            </dd>
          </div>
          <div><dt>Updated</dt><dd>{updated}</dd></div>
          <div className="wide"><dt>Management</dt><dd>{management}</dd></div>
          {details?.managedLaunchDisplay !== undefined && (
            <div className="wide"><dt>Launch</dt><dd>{details.managedLaunchDisplay}</dd></div>
          )}
        </dl>



        {developmentServer?.configuration !== undefined && (
          <section className="session-details-section development-server-details">
            <h2>Development Server <span>{titleCase(developmentServer.lifecycle)}</span></h2>
            <p className="development-server-command">{developmentServer.configuration.command}</p>
            <div className="session-details-actions">
              {developmentServer.lifecycle === "running" ? (
                <>
                  {developmentServer.previewUrl !== undefined && (
                    <a href={developmentServer.previewUrl} target="_blank" rel="noreferrer">Open preview <ExternalLink aria-hidden="true" size={14} /></a>
                  )}
                  <button type="button" disabled={developmentServerPending} onClick={onViewDevelopmentServerOutput}>View output</button>
                  <button type="button" disabled={developmentServerPending} onClick={onStopDevelopmentServer}>Stop server</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={developmentServerPending} onClick={onStartDevelopmentServer}>Start server</button>
                  <button type="button" disabled={developmentServerPending} onClick={onViewDevelopmentServerOutput}>View output</button>
                </>
              )}
            </div>
            {developmentServer.safeFailure !== undefined && <p role="alert">{developmentServer.safeFailure}</p>}
            {developmentServerError !== undefined && <p role="alert">{developmentServerError}</p>}
            {developmentServerOutput !== undefined && <pre aria-label="Development Server output">{developmentServerOutput || "No output captured."}</pre>}
          </section>
        )}

        <section className="session-details-section session-details-shared-files">
          <h2>Shared files <span>{details?.sharedFiles?.length ?? 0}</span></h2>
          {details !== undefined && details.sharedFiles !== undefined && details.sharedFiles.length > 0 ? (
            <ul>{details.sharedFiles.map((file) => (
              <li key={file.url}>
                {/\.(?:md|markdown)$/iu.test(file.name) ? (
                  <button className="session-details-shared-file" type="button" onClick={() => onOpenSharedMarkdown(file)}>
                    <FileText aria-hidden="true" size={17} />
                    <span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
                  </button>
                ) : (
                  <a href={file.url} target="_blank" rel="noreferrer">
                    <FileText aria-hidden="true" size={17} />
                    <span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
                    <ExternalLink aria-hidden="true" size={14} />
                  </a>
                )}
              </li>
            ))}</ul>
          ) : <p>No shared files.</p>}
        </section>

        <section className="session-details-section">
          <h2>Move Session</h2>
          {summary.pendingProjectMove === undefined ? (
            <form className="session-setting-form" onSubmit={(event) => {
              event.preventDefault();
              const target = projects.find((item) => item.projectId === moveProjectId);
              if (target === undefined) return;
              const timing = projection.run === "working" ? " after the current turn is complete" : " now";
              if (window.confirm(`Move this Session to ${target.name}${timing}?`)) onMoveSession(target.projectId);
            }}>
              <label><span>Destination Project</span><select aria-label="Move Session Project" value={moveProjectId} onChange={(event) => setMoveProjectId(event.target.value)}>
                {projects.filter((item) => item.available).map((item) => <option key={item.projectId} value={item.projectId}>{item.name}</option>)}
              </select></label>
              <div><button type="submit" disabled={moveProjectId === ""}>Move Session</button></div>
            </form>
          ) : (
            <div><p role="status">Move scheduled for {summary.pendingProjectMove.projectName}.</p><button type="button" onClick={onCancelMove}>Cancel scheduled move</button></div>
          )}
        </section>

        <section className="session-details-section">
          <h2>Actions</h2>
          <div className="session-details-actions">
            {project !== undefined && (
              <button type="button" onClick={onNewSession}>New Session in Project</button>
            )}
            {project !== undefined && (
              <button type="button" disabled={bookmarkSaving} onClick={() => onSetBookmark(!bookmarked)}>
                {bookmarked ? "Remove Session Bookmark" : "Bookmark Session"}
              </button>
            )}
            {canCloneSession && (
              <button type="button" disabled={settingSaving} onClick={onCloneSession}>Clone Session</button>
            )}
            {canReloadSession && (
              <button type="button" disabled={reloadSaving} onClick={onReloadSession}>
                {reloadSaving ? "Reloading Pi Session…" : "Reload Pi Session"}
              </button>
            )}
            {canRestartSession && (
              <button type="button" disabled={restartSaving} onClick={onRestartSession}>
                {restartSaving ? "Restarting Session…" : "Restart Session"}
              </button>
            )}
            {canCloseSession && (
              <button
                className="session-details-close-action"
                type="button"
                onClick={onRequestCloseSession}
              >
                Close Session
              </button>
            )}
          </div>
          {bookmarkError !== undefined && <p role="alert">{bookmarkError}</p>}
          {copyState === "failed" && <p role="alert">Could not copy the Session ID.</p>}
          {reloadError !== undefined && <p role="alert">{reloadError}</p>}
          {restartError !== undefined && <p role="alert">{restartError}</p>}
        </section>

        <details className="session-details-section">
          <summary>Capabilities <span>{projection.capabilities.length}</span></summary>
          {projection.capabilities.length > 0 ? (
            <ul>{projection.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul>
          ) : <p>No capabilities reported.</p>}
        </details>

        <details className="session-details-section">
          <summary>Commands <span>{details?.commandInventory.length ?? 0}</span></summary>
          {details !== undefined && details.commandInventory.length > 0 ? (
            <ul>{details.commandInventory.map((command) => (
              <li key={`${command.source}:${command.name}`}>
                <strong>{command.name}</strong>
                {command.description !== undefined && <span>{command.description}</span>}
              </li>
            ))}</ul>
          ) : <p>No commands reported.</p>}
        </details>
      </div>
    </aside>
  );
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
