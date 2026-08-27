import type { SelectedSessionState } from "./selected-session-state";
/* eslint-disable @typescript-eslint/no-unused-vars -- Compatibility methods keep the established Workspace client interface. */
import type {
  ApplicationCommand,
  ApplicationCommandResult,
  ApplicationError,
  BookmarkMutationResult,
  CapabilityId,
  DevelopmentServerOutputResult,
  DevelopmentServerResult,
  DevelopmentServerState,
  DirectoryListResult,
  ManagedSessionCreateOutcome,
  ManagedSessionRestartOutcome,
  ProjectClosedSessionsListOutcome,
  ProjectCreateResult,
  ProjectBookmark,
  ProjectId,
  ProjectSummary,
  SessionBookmark,
  SessionKey,
  SessionSummary,
} from "./workspace-model";

function imageUploadFailure(status: number): string {
  if (status === 413) return "Image is larger than 10 MB.";
  if (status === 415) return "Use a PNG, JPEG, or WebP image.";
  if (status === 401 || status === 403) return "Image upload is not authorized. Refresh Pi Station and try again.";
  return "Image upload failed. Try again.";
}

export interface CommandState {
  readonly requestId: string;
  readonly status: "queued" | "accepted" | "not-accepted" | "completed";
  readonly result?: ApplicationCommandResult;
  readonly error?: ApplicationError;
}

export interface ManagedSessionCreateState {
  readonly requestId: string;
  readonly status: "starting" | "succeeded" | "failed" | "outcome-unknown";
  readonly result?: ManagedSessionCreateOutcome;
}

export interface ManagedSessionRestartState {
  readonly requestId: string;
  readonly status: "restarting" | "succeeded" | "failed" | "outcome-unknown";
  readonly result?: ManagedSessionRestartOutcome;
}

export interface DirectoryListState {
  readonly requestId: string;
  readonly status: "loading" | "succeeded" | "failed";
  readonly result?: DirectoryListResult["outcome"];
}

export interface ProjectCreateState {
  readonly requestId: string;
  readonly status: "saving" | "succeeded" | "failed";
  readonly result?: ProjectCreateResult["outcome"];
}

export interface ProjectClosedSessionsState {
  readonly requestId: string;
  readonly projectId: ProjectId;
  readonly status: "loading" | "succeeded" | "failed";
  readonly result?: ProjectClosedSessionsListOutcome;
}

export interface BookmarkMutationState {
  readonly requestId: string;
  readonly status: "saving" | "succeeded" | "failed";
  readonly result?: BookmarkMutationResult["outcome"];
}

export interface ProjectRemovalState {
  readonly requestId: string;
  readonly projectId: ProjectId;
  readonly status: "saving" | "succeeded" | "failed";
  readonly error?: string;
}

export interface DevelopmentServerRequestState {
  readonly requestId: string;
  readonly projectId: ProjectId;
  readonly action: "configure" | "status" | "start" | "stop" | "output";
  readonly status: "loading" | "succeeded" | "failed";
  readonly result?: DevelopmentServerResult["outcome"]
    | DevelopmentServerOutputResult["outcome"];
}

export interface QuickSessionActionState { readonly type: "clear" | "keep"; readonly status: "pending" | "failed"; readonly error?: string }

export interface ApplicationState {
  readonly connection:
    | "connecting"
    | "synchronizing"
    | "ready"
    | "reconnecting"
    | "authentication-required"
    | "stopped";
  readonly streamId?: string;
  readonly applicationSequence?: number;
  readonly hostCapabilities: readonly CapabilityId[];
  readonly projectBookmarks: readonly ProjectBookmark[];
  readonly sessionBookmarks: readonly SessionBookmark[];
  readonly projects: readonly ProjectSummary[];
  readonly developmentServers: readonly DevelopmentServerState[];
  readonly sessions: readonly SessionSummary[];
  readonly selected: SelectedSessionState;
  readonly selectedSessionKey: SessionKey | undefined;
  readonly commands: Readonly<Record<string, CommandState>>;
  readonly managedSessionCreates: Readonly<Record<string, ManagedSessionCreateState>>;
  readonly managedSessionRestarts: Readonly<Record<string, ManagedSessionRestartState>>;
  readonly directoryLists: Readonly<Record<string, DirectoryListState>>;
  readonly projectCreates: Readonly<Record<string, ProjectCreateState>>;
  readonly projectClosedSessions: Readonly<Record<string, ProjectClosedSessionsState>>;
  readonly bookmarkMutations: Readonly<Record<string, BookmarkMutationState>>;
  readonly projectRemovals: Readonly<Record<string, ProjectRemovalState>>;
  readonly developmentServerRequests: Readonly<Record<string, DevelopmentServerRequestState>>;
  readonly developmentServerOutput: Readonly<Record<string, string>>;
  readonly historyLoading: boolean;
  readonly quickSessionAction?: QuickSessionActionState | undefined;
  readonly malformedFrames: number;
}

export const sessionKeysEqual = (
  left: SessionKey,
  right: SessionKey,
): boolean =>
  left.piSessionId === right.piSessionId;

export class ApplicationClientBase {
  get snapshot(): ApplicationState { throw new Error("Application client snapshot is not implemented"); }
  subscribe(_listener: (state: ApplicationState) => void): () => void { return () => undefined; }
  connect(): void {}
  stop(): void {}
  reportWorkspacePaint(_timelineItems: number): void {}
  select(_sessionKey: SessionKey): void {}
  setProjectBookmark(_projectId: ProjectId, _bookmarked: boolean): string | undefined { return undefined; }
  reorderProjectBookmark(_projectId: ProjectId, _direction: "up" | "down"): string | undefined { return undefined; }
  setSessionBookmark(_projectId: ProjectId, _sessionKey: SessionKey, _bookmarked: boolean): string | undefined { return undefined; }
  reorderSessionBookmark(_projectId: ProjectId, _sessionKey: SessionKey, _direction: "up" | "down"): string | undefined { return undefined; }
  listClosedProjectSessions(_projectId: ProjectId): string | undefined { return undefined; }
  removeProject(_projectId: ProjectId): string | undefined { return undefined; }
  createProject(_name: string, _directory: string): string | undefined { return undefined; }
  renameProject(_projectId: ProjectId, _name: string): Promise<void> { return Promise.reject(new Error("Project rename is unavailable")); }
  configureDevelopmentServer(_projectId: ProjectId, _configuration: unknown): string | undefined { return undefined; }
  startDevelopmentServer(_projectId: ProjectId): string | undefined { return undefined; }
  stopDevelopmentServer(_projectId: ProjectId): string | undefined { return undefined; }
  loadDevelopmentServerOutput(_projectId: ProjectId): string | undefined { return undefined; }
  listDirectory(_path?: string, _showHidden = false): string | undefined { return undefined; }
  createManagedSession(_workingDirectory: string, _optionalName?: string, _resumeSessionKey?: SessionKey): string | undefined { return undefined; }
  restartManagedSession(_sessionKey: SessionKey, _expectedGenerationId: string): string | undefined { return undefined; }
  requestEarlierHistory(): boolean { return false; }
  async uploadImage(file: File, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.imageUploadPath()}?name=${encodeURIComponent(file.name || "image")}`, {
      method: "POST",
      credentials: "same-origin",
      body: file,
      headers: { "Content-Type": file.type, Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    const payload = await response.json().catch(() => ({})) as {
      id?: unknown;
      error?: string | { message?: string };
    };
    if (!response.ok || typeof payload.id !== "string") {
      const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(detail ?? imageUploadFailure(response.status));
    }
    return payload.id;
  }
  async deleteImage(id: string): Promise<void> {
    const response = await fetch(`${this.imageUploadPath()}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(imageUploadFailure(response.status));
  }
  protected imageUploadPath(): string { return "/v2/images"; }
  executeCommand(_action: ApplicationCommand["action"], _targetSessionKey?: SessionKey): string | undefined { return undefined; }
}
