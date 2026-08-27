import type {
  AuthTransaction,
  PiStationSettings,
  PiStationUpdateStatus,
  ProviderAuthStatus,
  ProviderAuthType,
  Project,
  SavedSession,
  ScheduledJob,
  ScheduledJobMutation,
  SessionHistoryPage,
  SessionPhase,
  SessionSettings,
  SessionSharedFiles,
  SessionUpdatedEvent,
  SessionView,
  StreamEvent,
  UpdateChannel,
  TimelineItem as RpcTimelineItem,
} from "@pi-station/application-protocol";
import type {
  ApplicationCommand,
  ApplicationCommandResult,
  ProjectId,
  ProjectSummary,
  SessionKey,
  SessionSummary,
} from "./workspace-model";

type ApplicationTimelineItem = ApplicationState["selected"]["timeline"][number];
type SucceededCommandEffect = Extract<ApplicationCommandResult["outcome"], { status: "succeeded" }>["effect"];
import { ApplicationClientBase, type ApplicationState } from "./application-client-base";

const RPC_CAPABILITIES = [
  "session.prompt.text",
  "session.prompt.steer",
  "session.prompt.follow-up",
  "session.abort",
  "session.undo",
  "session.close",
  "session.clone",
  "session.reload",
  "session.rename",
  "session.model.set",
  "session.thinking.set",
] as const;

interface RpcTarget {
  readonly projectId: string;
  readonly sessionId: string;
}

interface ProjectsResponse { readonly projects: readonly Project[]; readonly bookmarks: ApplicationState["projectBookmarks"] }
interface SessionPhaseSummary { readonly projectId: string; readonly sessionId: string; readonly phase: SessionPhase; readonly epoch: string; readonly generation: number }
interface SessionPhaseUpdatedEvent { readonly version: 2; readonly type: "session.phase"; readonly session: SessionPhaseSummary }
interface SessionsResponse { readonly sequence: number; readonly sessions: readonly SavedSession[]; readonly phases?: readonly SessionPhaseSummary[]; readonly bookmarks: ApplicationState["sessionBookmarks"] }

function sessionPath(target: RpcTarget): string {
  return `/v2/projects/${encodeURIComponent(target.projectId)}/sessions/${encodeURIComponent(target.sessionId)}`;
}

function targetFromKey(key: SessionKey): RpcTarget {
  return { projectId: key.hostId, sessionId: key.piSessionId };
}

function keyFromSession(session: SavedSession): SessionKey {
  return { hostId: session.projectId, piSessionId: session.id };
}

function emptyState(): ApplicationState {
  return {
    connection: "connecting",
    hostCapabilities: ["managed-session.create"],
    projectBookmarks: [],
    sessionBookmarks: [],
    projects: [],
    developmentServers: [],
    sessions: [],
    selected: { timeline: [], hasEarlierHistory: false },
    selectedSessionKey: undefined,
    commands: {},
    managedSessionCreates: {},
    managedSessionRestarts: {},
    directoryLists: {},
    projectCreates: {},
    projectClosedSessions: {},
    bookmarkMutations: {},
    projectRemovals: {},
    developmentServerRequests: {},
    developmentServerOutput: {},
    historyLoading: false,
    malformedFrames: 0,
  };
}

export class ApplicationClient extends ApplicationClientBase {
  private rpcState = emptyState();
  private readonly rpcListeners = new Set<(state: ApplicationState) => void>();
  private eventSource: EventSource | undefined;
  private sessionUpdates: EventSource | undefined;
  private selectionGeneration = 0;
  private selectedVisible = false;
  private markReadSignature: string | undefined;
  private readonly phaseRevisions = new Map<string, { epoch?: string; generation: number; seenEpochs: Set<string> }>();
  private wakeReconciliation: Promise<void> | undefined;
  private readonly reconcileOnWake = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.reconcileSessionSummaries();
  };

  override get snapshot(): ApplicationState {
    return this.rpcState;
  }

  override subscribe(listener: (state: ApplicationState) => void): () => void {
    this.rpcListeners.add(listener);
    listener(this.rpcState);
    return () => this.rpcListeners.delete(listener);
  }

  override connect(): void {
    this.updateRpcState({ connection: "synchronizing" });
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.reconcileOnWake);
      window.addEventListener("pageshow", this.reconcileOnWake);
      window.addEventListener("focus", this.reconcileOnWake);
      document.addEventListener("visibilitychange", this.reconcileOnWake);
    }
    void this.refresh().catch((error: unknown) => {
      console.error("Pi Station connection failed", error);
      this.updateRpcState({ connection: "reconnecting" });
    });
  }

  override stop(): void {
    this.selectionGeneration += 1;
    this.selectedVisible = false;
    this.markReadSignature = undefined;
    this.eventSource?.close();
    this.eventSource = undefined;
    this.sessionUpdates?.close();
    this.sessionUpdates = undefined;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.reconcileOnWake);
      window.removeEventListener("pageshow", this.reconcileOnWake);
      window.removeEventListener("focus", this.reconcileOnWake);
      document.removeEventListener("visibilitychange", this.reconcileOnWake);
    }
    this.updateRpcState({ connection: "stopped" });
  }

  setSelectedVisible(visible: boolean): void {
    this.selectedVisible = visible;
    if (visible) this.markSelectedAttentionRead();
  }

  protected override imageUploadPath(): string {
    return "/v2/images";
  }

  override select(key: SessionKey): void {
    const target = targetFromKey(key);
    const generation = ++this.selectionGeneration;
    this.eventSource?.close();
    this.eventSource = undefined;
    this.updateRpcState({ selectedSessionKey: key });

    void request<SessionView>(sessionPath(target)).then((view) => {
      if (generation !== this.selectionGeneration) return;
      this.applyView(view);
      this.openEvents(target, generation, view.eventCursor);
    }).catch((error: unknown) => {
      if (generation !== this.selectionGeneration) return;
      console.error("Pi Station Session open failed", error);
    });
  }

  override requestEarlierHistory(): boolean {
    const key = this.rpcState.selectedSessionKey;
    const before = this.rpcState.selected.historyCursor;
    if (key === undefined || before === undefined || this.rpcState.historyLoading || !this.rpcState.selected.hasEarlierHistory) return false;

    const generation = this.selectionGeneration;
    const target = targetFromKey(key);
    const revision = this.rpcState.selected.historyRevision;
    this.updateRpcState({ historyLoading: true });
    void request<SessionHistoryPage>(`${sessionPath(target)}/history?before=${encodeURIComponent(before)}`).then((page) => {
      if (generation !== this.selectionGeneration || page.revision !== revision) return;
      const earlier = mapTimeline(page.timeline, key, "saved");
      const known = new Set(this.rpcState.selected.timeline.map(({ timelineItemId }) => timelineItemId));
      const selected = { ...this.rpcState.selected };
      delete selected.historyCursor;
      this.rpcState = {
        ...this.rpcState,
        historyLoading: false,
        selected: {
          ...selected,
          ...(page.before === undefined ? {} : { historyCursor: page.before }),
          hasEarlierHistory: page.hasEarlier,
          timeline: [...earlier.filter(({ timelineItemId }) => !known.has(timelineItemId)), ...this.rpcState.selected.timeline],
        },
      };
      this.emitRpcState();
    }).catch((error: unknown) => {
      if (generation !== this.selectionGeneration) return;
      console.error("Pi Station history request failed", error);
      this.updateRpcState({ historyLoading: false });
      this.select(key);
    });
    return true;
  }

  async openQuickSession(): Promise<SessionKey> {
    const response = await mutate("/v2/quick-session", "POST", {}) as { session: SavedSession };
    await this.refresh();
    this.updateRpcState({ connection: "ready" });
    const key = keyFromSession(response.session);
    this.select(key);
    return key;
  }

  async clearQuickSession(): Promise<void> {
    const before = this.rpcState.sessions.find(({ quickSession }) => quickSession === true)?.sessionKey.piSessionId;
    const response = await mutate("/v2/quick-session/clear", "POST", {}) as QuickSessionResponse;
    if (response.action?.status === "pending") await this.waitForQuickSession((session) => session !== undefined && session.id !== before);
    await this.refresh();
    const quick = this.rpcState.sessions.find(({ quickSession }) => quickSession === true);
    if (quick !== undefined) this.select(quick.sessionKey);
  }

  async keepQuickSession(destination: string): Promise<void> {
    const response = await mutate("/v2/quick-session/keep", "POST", { destination }) as QuickSessionResponse;
    if (response.action?.status === "pending") await this.waitForQuickSession((session) => session === undefined);
    await this.refresh();
  }

  async cancelQuickSessionAction(): Promise<void> {
    await mutate("/v2/quick-session/cancel", "POST", {});
    this.updateRpcState({ quickSessionAction: undefined });
    await this.refresh();
  }

  private async waitForQuickSession(done: (session: SavedSession | undefined) => boolean): Promise<void> {
    for (;;) {
      const response = await request<QuickSessionResponse>("/v2/quick-session");
      if (response.action?.status === "failed") {
        this.updateRpcState({ quickSessionAction: { type: response.action.type, status: "failed", error: response.action.error ?? "Quick Session action failed." } });
        throw new Error(response.action.error ?? "Quick Session action failed.");
      }
      if (done(response.session)) { this.updateRpcState({ quickSessionAction: undefined }); return; }
      if (response.action?.status === "pending") this.updateRpcState({ quickSessionAction: { type: response.action.type, status: "pending" } });
      else { this.updateRpcState({ quickSessionAction: undefined }); return; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async getAuthProviders(): Promise<readonly ProviderAuthStatus[]> { return (await request<{ providers: ProviderAuthStatus[] }>("/v2/auth/providers")).providers; }
  async startProviderLogin(providerId: string, type: ProviderAuthType): Promise<AuthTransaction> { return (await mutate("/v2/auth/login", "POST", { providerId, type }) as { transaction: AuthTransaction }).transaction; }
  async getAuthTransaction(id: string): Promise<AuthTransaction> { return (await request<{ transaction: AuthTransaction }>(`/v2/auth/transactions/${encodeURIComponent(id)}`)).transaction; }
  async answerAuthPrompt(id: string, value: string): Promise<AuthTransaction> { return (await mutate(`/v2/auth/transactions/${encodeURIComponent(id)}/response`, "POST", { value }) as { transaction: AuthTransaction }).transaction; }
  async cancelProviderLogin(id: string): Promise<AuthTransaction> { return (await mutate(`/v2/auth/transactions/${encodeURIComponent(id)}`, "DELETE") as { transaction: AuthTransaction }).transaction; }
  async logoutProvider(providerId: string): Promise<readonly ProviderAuthStatus[]> { return (await mutate(`/v2/auth/providers/${encodeURIComponent(providerId)}`, "DELETE") as { providers: ProviderAuthStatus[] }).providers; }
  async getPiStationSettings(): Promise<PiStationSettings> { return (await request<{ settings: PiStationSettings }>("/v2/settings")).settings; }
  async setPiStationTimezone(timezone: string): Promise<PiStationSettings> { return (await mutate("/v2/settings", "PUT", { timezone }) as { settings: PiStationSettings }).settings; }
  async getUpdateStatus(): Promise<PiStationUpdateStatus> { return (await request<{ update: PiStationUpdateStatus }>("/v2/update")).update; }
  async setUpdateChannel(channel: UpdateChannel): Promise<PiStationUpdateStatus> { return (await mutate("/v2/update/channel", "PUT", { channel }) as { update: PiStationUpdateStatus }).update; }
  async requestUpdate(): Promise<void> { await mutate("/v2/update", "POST", {}); }
  async listScheduledJobs(projectId: string): Promise<readonly ScheduledJob[]> { return (await request<{ jobs: ScheduledJob[] }>(`/v2/scheduled-jobs?projectId=${encodeURIComponent(projectId)}`)).jobs; }
  async createScheduledJob(projectId: string, input: ScheduledJobMutation): Promise<ScheduledJob> { return (await mutate("/v2/scheduled-jobs", "POST", { projectId, ...input }) as { job: ScheduledJob }).job; }
  async updateScheduledJob(id: string, input: ScheduledJobMutation): Promise<ScheduledJob> { return (await mutate(`/v2/scheduled-jobs/${encodeURIComponent(id)}`, "PUT", input) as { job: ScheduledJob }).job; }
  async scheduledJobAction(id: string, action: "pause" | "resume" | "run-now" | "delete"): Promise<void> { await mutate(`/v2/scheduled-jobs/${encodeURIComponent(id)}${action === "delete" ? "" : `/${action}`}`, action === "delete" ? "DELETE" : "POST", action === "run-now" ? {} : action === "delete" ? undefined : {}); }

  async uploadAttachment(file: File, signal?: AbortSignal): Promise<string> {
    const key = this.rpcState.selectedSessionKey;
    if (key === undefined) throw new Error("Select a Session before you attach a file.");
    const target = targetFromKey(key);
    const response = await fetch(`${sessionPath(target)}/attachments?name=${encodeURIComponent(file.name || "file")}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream", Accept: "application/json" }, body: file, ...(signal === undefined ? {} : { signal }) });
    const payload = await response.json().catch(() => ({})) as { attachment?: { id?: unknown }; error?: string };
    if (!response.ok || typeof payload.attachment?.id !== "string") throw new Error(payload.error ?? (response.status === 413 ? "File is larger than 25 MB." : "File upload failed."));
    return payload.attachment.id;
  }

  async deleteAttachment(id: string): Promise<void> {
    const key = this.rpcState.selectedSessionKey; if (key === undefined) return;
    const response = await fetch(`${sessionPath(targetFromKey(key))}/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error("File removal failed.");
  }

  override setSessionBookmark(projectId: ProjectId, sessionKey: SessionKey, bookmarked: boolean): string | undefined {
    return this.mutateSessionBookmark({ action: "set", projectId, sessionId: sessionKey.piSessionId, bookmarked });
  }

  override reorderSessionBookmark(projectId: ProjectId, sessionKey: SessionKey, direction: "up" | "down"): string | undefined {
    return this.mutateSessionBookmark({ action: "reorder", projectId, sessionId: sessionKey.piSessionId, direction });
  }

  override setProjectBookmark(projectId: ProjectId, bookmarked: boolean): string | undefined {
    return this.mutateProjectBookmark({ action: "set", projectId, bookmarked });
  }

  override reorderProjectBookmark(projectId: ProjectId, direction: "up" | "down"): string | undefined {
    return this.mutateProjectBookmark({ action: "reorder", projectId, direction });
  }

  override listDirectory(path?: string, showHidden = false): string | undefined {
    if (this.rpcState.connection !== "ready") return undefined;
    const requestId = crypto.randomUUID();
    this.rpcState = {
      ...this.rpcState,
      directoryLists: { ...this.rpcState.directoryLists, [requestId]: { requestId, status: "loading" } },
    };
    this.emitRpcState();
    const query = new URLSearchParams();
    if (path !== undefined) query.set("path", path);
    if (showHidden) query.set("hidden", "true");
    void request<{ current: { name: string; path: string; displayPath: string }; parent?: { name: string; path: string; displayPath: string }; directories: Array<{ name: string; path: string; displayPath: string }> }>(`/v2/directories?${query}`).then((result) => {
      this.rpcState = {
        ...this.rpcState,
        directoryLists: { ...this.rpcState.directoryLists, [requestId]: { requestId, status: "succeeded", result: { status: "succeeded", ...result } } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    }).catch((error: unknown) => {
      this.rpcState = {
        ...this.rpcState,
        directoryLists: { ...this.rpcState.directoryLists, [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "directory-list-failed", message: error instanceof Error ? error.message : "Directory list failed", retryable: true } } } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    });
    return requestId;
  }

  override createProject(name: string, directory: string): string | undefined {
    if (this.rpcState.connection !== "ready") return undefined;
    const requestId = crypto.randomUUID();
    this.rpcState = {
      ...this.rpcState,
      projectCreates: { ...this.rpcState.projectCreates, [requestId]: { requestId, status: "saving" } },
    };
    this.emitRpcState();
    void mutate("/v2/projects", "POST", { root: directory, name }).then(async () => {
      const response = await request<ProjectsResponse>("/v2/projects");
      const projects = response.projects.map(projectSummary);
      this.updateRpcState({ projects, projectBookmarks: response.bookmarks });
      const project = projects.find((item) => item.displayPath === directory);
      if (project === undefined) throw new Error("Created Project was not returned");
      this.rpcState = {
        ...this.rpcState,
        projectCreates: { ...this.rpcState.projectCreates, [requestId]: { requestId, status: "succeeded", result: { status: "succeeded", project } } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    }).catch((error: unknown) => {
      this.rpcState = {
        ...this.rpcState,
        projectCreates: { ...this.rpcState.projectCreates, [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "project-create-failed", message: error instanceof Error ? error.message : "Project creation failed", retryable: false } } } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    });
    return requestId;
  }

  override async renameProject(projectId: ProjectId, name: string): Promise<void> {
    if (this.rpcState.connection !== "ready") throw new Error("Pi Station is not connected");
    const response = await mutate(`/v2/projects/${encodeURIComponent(projectId)}`, "PUT", { name }) as { projects: readonly Project[] };
    this.updateRpcState({ projects: response.projects.map(projectSummary) });
  }

  override async setProjectClosed(projectId: ProjectId, closed: boolean): Promise<void> {
    if (this.rpcState.connection !== "ready") throw new Error("Pi Station is not connected");
    const response = await mutate(`/v2/projects/${encodeURIComponent(projectId)}/${closed ? "close" : "open"}`, "POST", {}) as ProjectsResponse;
    this.updateRpcState({ projects: response.projects.map(projectSummary), projectBookmarks: response.bookmarks });
  }

  override removeProject(projectId: ProjectId): string | undefined {
    if (this.rpcState.connection !== "ready") return undefined;
    const requestId = crypto.randomUUID();
    this.rpcState = {
      ...this.rpcState,
      projectRemovals: { ...this.rpcState.projectRemovals, [requestId]: { requestId, projectId, status: "saving" } },
    };
    this.emitRpcState();
    void mutate(`/v2/projects/${encodeURIComponent(projectId)}`, "DELETE").then((result) => {
      const response = result as ProjectsResponse;
      const selectedIsRemoved = String(this.rpcState.selectedSessionKey?.hostId) === String(projectId);
      if (selectedIsRemoved) {
        this.selectionGeneration += 1;
        this.eventSource?.close();
        this.eventSource = undefined;
      }
      this.rpcState = {
        ...this.rpcState,
        projects: response.projects.map(projectSummary),
        projectBookmarks: response.bookmarks,
        sessionBookmarks: this.rpcState.sessionBookmarks.filter((bookmark) => bookmark.projectId !== projectId),
        sessions: this.rpcState.sessions.filter((session) => session.projectId !== projectId),
        developmentServers: this.rpcState.developmentServers.filter((server) => server.projectId !== projectId),
        ...(selectedIsRemoved ? { selectedSessionKey: undefined, selected: { timeline: [], hasEarlierHistory: false } } : {}),
        projectRemovals: { ...this.rpcState.projectRemovals, [requestId]: { requestId, projectId, status: "succeeded" } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    }).catch((error: unknown) => {
      this.rpcState = {
        ...this.rpcState,
        projectRemovals: { ...this.rpcState.projectRemovals, [requestId]: {
          requestId,
          projectId,
          status: "failed",
          error: error instanceof Error ? error.message : "Project removal failed",
        } },
      };
      this.emitRpcState();
    });
    return requestId;
  }

  override listClosedProjectSessions(projectId: ProjectId): string | undefined {
    const requestId = crypto.randomUUID();
    const sessions = this.rpcState.sessions.filter((session) => session.projectId === projectId
      && session.projection.availability === "closed");
    this.rpcState = {
      ...this.rpcState,
      projectClosedSessions: {
        ...this.rpcState.projectClosedSessions,
        [projectId]: { requestId, projectId, status: "succeeded", result: { status: "succeeded", sessions } },
      },
    } as unknown as ApplicationState;
    this.emitRpcState();
    return requestId;
  }

  override createManagedSession(
    workingDirectory: string,
    optionalName?: string,
    resumeSessionKey?: SessionKey,
  ): string {
    const requestId = crypto.randomUUID();
    const project = this.rpcState.projects.find((item) => item.displayPath === workingDirectory);
    if (project === undefined) {
      if (resumeSessionKey !== undefined) {
        this.rpcState = {
          ...this.rpcState,
          managedSessionCreates: {
            ...this.rpcState.managedSessionCreates,
            [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "project-not-found", message: "Project is not configured", retryable: false } } },
          },
        } as unknown as ApplicationState;
        this.emitRpcState();
        return requestId;
      }
      this.rpcState = {
        ...this.rpcState,
        managedSessionCreates: {
          ...this.rpcState.managedSessionCreates,
          [requestId]: { requestId, status: "starting" },
        },
      } as unknown as ApplicationState;
      this.emitRpcState();
      void mutate("/v2/session-hosts", "POST", { root: workingDirectory }).then((result) => {
        const response = result as { project: Project };
        this.completeDraftSession(requestId, projectSummary(response.project), optionalName);
      }).catch((error: unknown) => {
        this.rpcState = {
          ...this.rpcState,
          managedSessionCreates: {
            ...this.rpcState.managedSessionCreates,
            [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "session-host-failed", message: error instanceof Error ? error.message : "Session directory could not be prepared", retryable: false } } },
          },
        } as unknown as ApplicationState;
        this.emitRpcState();
      });
      return requestId;
    }

    if (resumeSessionKey !== undefined) {
      const target = targetFromKey(resumeSessionKey);
      void mutate(`${sessionPath(target)}/state`, "PUT", { state: "open" }).then(() => {
        const existing = this.rpcState.sessions.find((session) => session.sessionKey.hostId === resumeSessionKey.hostId
          && session.sessionKey.piSessionId === resumeSessionKey.piSessionId);
        if (existing === undefined) throw new Error("Closed Session is not indexed");
        this.rpcState = {
          ...this.rpcState,
          sessions: upsertSessionSummary(this.rpcState.sessions, {
            id: target.sessionId,
            projectId: target.projectId,
            path: existing.displayPath ?? workingDirectory,
            ...(existing.name === undefined ? {} : { name: existing.name }),
            modifiedAt: existing.lastActivityAt ?? new Date().toISOString(),
            state: "open",
          }),
          managedSessionCreates: {
            ...this.rpcState.managedSessionCreates,
            [requestId]: { requestId, status: "succeeded", result: { status: "succeeded", sessionKey: resumeSessionKey } },
          },
        } as unknown as ApplicationState;
        this.emitRpcState();
      }).catch((error: unknown) => {
        this.rpcState = {
          ...this.rpcState,
          managedSessionCreates: {
            ...this.rpcState.managedSessionCreates,
            [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "session-open-failed", message: error instanceof Error ? error.message : "Session open failed", retryable: false } } },
          },
        } as unknown as ApplicationState;
        this.emitRpcState();
      });
      return requestId;
    }

    this.completeDraftSession(requestId, project, optionalName);
    return requestId;
  }

  private completeDraftSession(
    requestId: string,
    project: ProjectSummary,
    optionalName?: string,
  ): void {
    void mutate(`/v2/projects/${encodeURIComponent(project.projectId)}/sessions`, "POST", {
      cwd: project.displayPath,
      ...(optionalName === undefined ? {} : { name: optionalName }),
    }).then((result) => {
      const response = result as { session: SavedSession };
      const summary = sessionSummary(response.session);
      const key = summary.sessionKey;
      this.rpcState = {
        ...this.rpcState,
        sessions: [summary, ...this.rpcState.sessions.filter((item) => item.sessionKey.piSessionId !== key.piSessionId)],
        managedSessionCreates: {
          ...this.rpcState.managedSessionCreates,
          [requestId]: { requestId, status: "succeeded", result: { status: "succeeded", sessionKey: key } },
        },
      };
      this.emitRpcState();
      this.select(key);
    }).catch((error: unknown) => {
      this.rpcState = {
        ...this.rpcState,
        managedSessionCreates: {
          ...this.rpcState.managedSessionCreates,
          [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "session-create-failed", message: error instanceof Error ? error.message : "Session could not be created", retryable: false } } },
        },
      };
      this.emitRpcState();
    });
  }

  override executeCommand(
    action: ApplicationCommand["action"],
    targetSessionKey?: SessionKey,
  ): string | undefined {
    const key = targetSessionKey ?? this.rpcState.selectedSessionKey;
    if (key === undefined) return undefined;
    const target = targetFromKey(key);
    const requestId = crypto.randomUUID();
    this.setRpcCommand(requestId, "queued");

    let operation: Promise<unknown>;
    let completedEffect: SucceededCommandEffect;
    if (action.kind === "prompt.send") {
      this.setPhase("working");
      this.addOptimisticUserMessage(requestId, action.text, key);
      operation = mutate(`${sessionPath(target)}/turn`, "POST", {
        prompt: action.text,
        ...(action.imageIds === undefined ? {} : { imageIds: action.imageIds }),
        ...((action as typeof action & { attachmentIds?: readonly string[] }).attachmentIds === undefined ? {} : { attachmentIds: (action as typeof action & { attachmentIds?: readonly string[] }).attachmentIds }),
        ...(action.agentMentions === undefined ? {} : { agentMentions: action.agentMentions }),
      });
    } else if (action.kind === "prompt.steer" || action.kind === "prompt.follow-up") {
      const delivery = action.kind === "prompt.steer" ? "steer" : "follow-up";
      operation = mutate(`${sessionPath(target)}/${delivery}`, "POST", {
        prompt: action.text,
        ...(action.imageIds === undefined ? {} : { imageIds: action.imageIds }),
        ...((action as typeof action & { attachmentIds?: readonly string[] }).attachmentIds === undefined ? {} : { attachmentIds: (action as typeof action & { attachmentIds?: readonly string[] }).attachmentIds }),
        ...(action.agentMentions === undefined ? {} : { agentMentions: action.agentMentions }),
      });
    } else if (action.kind === "session.abort") {
      operation = mutate(`${sessionPath(target)}/abort`, "POST", {});
    } else if (action.kind === "session.undo") {
      operation = mutate(`${sessionPath(target)}/undo`, "POST", { entryId: action.entryId }).then(() => this.select(key));
    } else if (action.kind === "session.close") {
      operation = mutate(`${sessionPath(target)}/state`, "PUT", { state: "closed" });
    } else if (action.kind === "session.clone") {
      const source = this.rpcState.sessions.find((session) => session.sessionKey.hostId === key.hostId
        && session.sessionKey.piSessionId === key.piSessionId);
      const cloneName = `${[...(source?.name ?? "Untitled Session")].slice(0, 114).join("")}-clone`;
      operation = mutate(`${sessionPath(target)}/clone`, "POST", { name: cloneName }).then((result) => {
        const response = result as { session: SavedSession };
        this.rpcState = { ...this.rpcState, sessions: upsertSessionSummary(this.rpcState.sessions, response.session) };
        const cloneKey = keyFromSession(response.session);
        completedEffect = { kind: "clone-created", piSessionId: cloneKey.piSessionId };
        this.emitRpcState();
        this.select(cloneKey);
      });
    } else if (action.kind === "session.reload") {
      operation = mutate(`${sessionPath(target)}/reload`, "POST", {});
    } else if (action.kind === "session.move") {
      operation = mutate(`${sessionPath(target)}/move`, "POST", { projectId: action.projectId });
    } else if (action.kind === "session.move.cancel") {
      operation = mutate(`${sessionPath(target)}/move`, "DELETE", undefined);
    } else if (action.kind === "session.model.set") {
      operation = mutate(`${sessionPath(target)}/model`, "PUT", { provider: action.provider, modelId: action.modelId }).then((result) => {
        this.applySettings((result as { settings: SessionSettings }).settings);
      });
    } else if (action.kind === "session.thinking.set") {
      operation = mutate(`${sessionPath(target)}/thinking`, "PUT", { level: action.level }).then((result) => {
        this.applySettings((result as { settings: SessionSettings }).settings);
      });
    } else if (action.kind === "session.rename") {
      operation = mutate(`${sessionPath(target)}/name`, "PUT", { name: action.name }).then((result) => {
        const response = result as { session: SavedSession };
        this.rpcState = {
          ...this.rpcState,
          sessions: upsertSessionSummary(this.rpcState.sessions, response.session),
          selected: { ...this.rpcState.selected, details: { ...this.rpcState.selected.details, name: response.session.name } },
        } as unknown as ApplicationState;
        this.emitRpcState();
      });
    } else {
      this.setRpcCommand(requestId, "not-accepted");
      return requestId;
    }

    this.setRpcCommand(requestId, "accepted");
    void operation.then(() => {
      if (action.kind === "session.close") {
        const existing = this.rpcState.sessions.find((session) => session.sessionKey.hostId === key.hostId
          && session.sessionKey.piSessionId === key.piSessionId);
        if (existing !== undefined) {
          this.rpcState = {
            ...this.rpcState,
            sessions: this.rpcState.sessions.map((session) => session === existing
              ? { ...session, projection: { ...session.projection, availability: "closed", capabilities: [] } }
              : session),
            selected: { ...this.rpcState.selected, projection: { ...this.rpcState.selected.projection, availability: "closed", capabilities: [] } },
          } as unknown as ApplicationState;
          this.emitRpcState();
        }
      }
      this.setRpcCommand(requestId, "completed", true, completedEffect);
    }).catch((error: unknown) => {
      console.error("Pi Station command failed", error);
      if (action.kind === "prompt.send") {
        this.removeOptimisticUserMessage(requestId);
        this.setPhase("idle");
      }
      this.setRpcCommand(requestId, "not-accepted");
    });
    return requestId;
  }

  private mutateSessionBookmark(body: unknown): string | undefined {
    if (this.rpcState.connection !== "ready") return undefined;
    const requestId = crypto.randomUUID();
    this.rpcState = { ...this.rpcState, bookmarkMutations: { ...this.rpcState.bookmarkMutations, [requestId]: { requestId, status: "saving" } } };
    this.emitRpcState();
    void mutate("/v2/session-bookmarks", "PUT", body).then((result) => {
      const response = result as { bookmarks: ApplicationState["sessionBookmarks"] };
      this.rpcState = { ...this.rpcState, sessionBookmarks: response.bookmarks, bookmarkMutations: { ...this.rpcState.bookmarkMutations, [requestId]: { requestId, status: "succeeded", result: { status: "succeeded" } } } } as unknown as ApplicationState;
      this.emitRpcState();
    }).catch((error: unknown) => {
      this.rpcState = { ...this.rpcState, bookmarkMutations: { ...this.rpcState.bookmarkMutations, [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "bookmark-failed", message: error instanceof Error ? error.message : "Bookmark failed", retryable: false } } } } } as unknown as ApplicationState;
      this.emitRpcState();
    });
    return requestId;
  }

  private mutateProjectBookmark(body: unknown): string | undefined {
    if (this.rpcState.connection !== "ready") return undefined;
    const requestId = crypto.randomUUID();
    this.rpcState = {
      ...this.rpcState,
      bookmarkMutations: { ...this.rpcState.bookmarkMutations, [requestId]: { requestId, status: "saving" } },
    };
    this.emitRpcState();
    void mutate("/v2/project-bookmarks", "PUT", body).then((result) => {
      const response = result as { bookmarks: ApplicationState["projectBookmarks"] };
      this.rpcState = {
        ...this.rpcState,
        projectBookmarks: response.bookmarks,
        bookmarkMutations: { ...this.rpcState.bookmarkMutations, [requestId]: { requestId, status: "succeeded", result: { status: "succeeded" } } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    }).catch((error: unknown) => {
      this.rpcState = {
        ...this.rpcState,
        bookmarkMutations: { ...this.rpcState.bookmarkMutations, [requestId]: { requestId, status: "failed", result: { status: "rejected", error: { code: "bookmark-failed", message: error instanceof Error ? error.message : "Bookmark failed", retryable: false } } } },
      } as unknown as ApplicationState;
      this.emitRpcState();
    });
    return requestId;
  }

  private addOptimisticUserMessage(requestId: string, text: string, key: SessionKey): void {
    if (
      this.rpcState.selectedSessionKey?.hostId !== key.hostId
      || this.rpcState.selectedSessionKey.piSessionId !== key.piSessionId
    ) return;
    const timeline = [
      ...this.rpcState.selected.timeline,
      {
        timelineItemId: `rpc-optimistic-${requestId}`,
        sessionKey: key,
        source: "optimistic",
        category: "user-message",
        content: { text },
      } as unknown as ApplicationTimelineItem,
    ];
    this.rpcState = {
      ...this.rpcState,
      selected: { ...this.rpcState.selected, timeline },
    };
    this.emitRpcState();
  }

  private removeOptimisticUserMessage(requestId: string): void {
    const timelineItemId = `rpc-optimistic-${requestId}`;
    this.rpcState = {
      ...this.rpcState,
      selected: {
        ...this.rpcState.selected,
        timeline: this.rpcState.selected.timeline.filter(
          (item) => item.timelineItemId !== timelineItemId,
        ),
      },
    };
    this.emitRpcState();
  }

  private async refresh(): Promise<void> {
    const selected = this.rpcState.selectedSessionKey;
    const [projectResponse, sessionResponse] = await Promise.all([
      request<ProjectsResponse>("/v2/projects"),
      request<SessionsResponse>("/v2/sessions"),
    ]);
    const projects = projectResponse.projects.map(projectSummary);
    const sessions = sessionResponse.sessions.map(sessionSummary);
    this.updateRpcState({ connection: "ready", projects, projectBookmarks: projectResponse.bookmarks, sessions, sessionBookmarks: sessionResponse.bookmarks });
    for (const phase of sessionResponse.phases ?? []) this.applySessionPhase(phase);
    this.openSessionUpdates(sessionResponse.sequence);

    if (selected !== undefined) {
      this.select(selected);
      return;
    }
    const first = sessions.find((session) => session.projection.availability === "available");
    if (first !== undefined) this.select(first.sessionKey);
  }

  private openSessionUpdates(after: number): void {
    this.sessionUpdates?.close();
    const source = new EventSource(`/v2/sessions/events?after=${after}`);
    this.sessionUpdates = source;
    let opened = false;
    source.addEventListener("open", () => {
      if (!opened) { opened = true; return; }
      this.reconcileSessionSummaries();
    });
    source.addEventListener("session.updated", ((message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SessionUpdatedEvent;
      this.applySessionUpdate(event.session);
    }) as EventListener);
    source.addEventListener("session.phase", ((message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SessionPhaseUpdatedEvent;
      this.applySessionPhase(event.session);
    }) as EventListener);
  }

  private reconcileSessionSummaries(): void {
    if (this.wakeReconciliation !== undefined || this.rpcState.connection === "stopped") return;
    this.wakeReconciliation = request<SessionsResponse>("/v2/sessions").then((response) => {
      const sessions = response.sessions.map(sessionSummary);
      this.rpcState = { ...this.rpcState, sessions, sessionBookmarks: response.bookmarks };
      for (const phase of response.phases ?? []) this.applySessionPhase(phase);
      this.emitRpcState();
      this.openSessionUpdates(response.sequence);
    }).catch((error: unknown) => {
      console.error("Pi Station Session summary reconciliation failed", error);
    }).finally(() => { this.wakeReconciliation = undefined; });
  }

  private applySessionPhase(phase: SessionPhaseSummary): void {
    const key = { hostId: phase.projectId, piSessionId: phase.sessionId } as SessionKey;
    const phaseKey = key.piSessionId;
    if (!this.acceptPhaseRevision(phaseKey, phase.epoch, phase.generation)) return;
    const run = phase.phase === "working" ? "working" : "idle";
    const sessions = this.rpcState.sessions.map((session) => session.sessionKey.piSessionId === key.piSessionId
      ? { ...session, projection: { ...session.projection, run } }
      : session);
    const selected = this.rpcState.selectedSessionKey?.piSessionId === key.piSessionId
      && this.rpcState.selected.projection !== undefined
      ? { ...this.rpcState.selected, projection: { ...this.rpcState.selected.projection, run } }
      : this.rpcState.selected;
    this.rpcState = { ...this.rpcState, sessions, selected } as ApplicationState;
    this.emitRpcState();
  }

  private applySessionUpdate(saved: SavedSession): void {
    const selectedBefore = this.rpcState.selectedSessionKey;
    const changed = sessionSummary(saved);
    const key = changed.sessionKey;
    const previous = this.rpcState.sessions.find((session) => session.sessionKey.piSessionId === key.piSessionId);
    const sessions = upsertSessionSummary(this.rpcState.sessions, saved).map((session) => session.sessionKey.piSessionId === key.piSessionId && previous !== undefined
      ? { ...session, projection: { ...session.projection, run: previous.projection.run } }
      : session);
    this.rpcState = { ...this.rpcState, sessions };
    if (
      this.rpcState.selectedSessionKey?.piSessionId === key.piSessionId
    ) {
      this.rpcState = {
        ...this.rpcState,
        selectedSessionKey: key,
        selected: { ...this.rpcState.selected, projection: {
          ...changed.projection,
          run: this.rpcState.selected.projection?.run ?? changed.projection.run,
        } },
      };
    }
    this.emitRpcState();
    if (selectedBefore?.piSessionId === key.piSessionId && selectedBefore.hostId !== key.hostId) {
      this.openEvents({ projectId: key.hostId, sessionId: key.piSessionId }, this.selectionGeneration, 0);
    }
    this.markSelectedAttentionRead();
  }

  private applyView(view: SessionView): void {
    const key = keyFromSession(view.session);
    const phaseKey = key.piSessionId;
    const applyPhase = this.acceptPhaseRevision(phaseKey, view.phaseEpoch, view.phaseGeneration);
    const currentRun = this.rpcState.selectedSessionKey?.piSessionId === key.piSessionId
      ? this.rpcState.selected.projection?.run
      : undefined;
    const projection = projectionFor(view.session, applyPhase ? view.phase : currentRun === "working" ? "working" : "idle");
    this.rpcState = {
      ...this.rpcState,
      selectedSessionKey: key,
      selected: {
        sessionKey: key,
        historyRevision: view.historyRevision ?? view.session.modifiedAt,
        ...(view.historyBefore === undefined ? {} : { historyCursor: view.historyBefore }),
        hasEarlierHistory: view.hasEarlierHistory ?? false,
        projection,
        details: {
          name: view.session.name,
          currentDirectoryDisplay: view.session.path,
          projectId: view.session.projectId,
          model: view.settings.model,
          modelInventory: view.settings.modelInventory,
          thinkingLevel: view.settings.thinkingLevel,
          supportedThinkingLevels: view.settings.supportedThinkingLevels,
          commandInventory: [],
          sharedFiles: view.sharedFiles,
        },
        queue: { state: "empty", knownItems: [] },
        timeline: mapTimeline(view.timeline, key, "saved"),
      },
      projects: this.rpcState.projects.map((project) => project.projectId === key.hostId ? { ...project, closed: false } : project),
      sessions: upsertSessionSummary(this.rpcState.sessions, view.session).map((session) => session.sessionKey.hostId === key.hostId
        && session.sessionKey.piSessionId === key.piSessionId
        ? { ...session, projection }
        : session),
    } as unknown as ApplicationState;
    this.emitRpcState();
    this.markSelectedAttentionRead();
  }

  private applySettings(settings: SessionSettings): void {
    this.rpcState = {
      ...this.rpcState,
      selected: {
        ...this.rpcState.selected,
        details: {
          ...this.rpcState.selected.details,
          model: settings.model,
          modelInventory: settings.modelInventory,
          thinkingLevel: settings.thinkingLevel,
          supportedThinkingLevels: settings.supportedThinkingLevels,
        },
      },
    } as unknown as ApplicationState;
    this.emitRpcState();
  }

  private openEvents(target: RpcTarget, generation: number, after: number): void {
    const source = new EventSource(`${sessionPath(target)}/events?after=${after}`);
    this.eventSource = source;
    let opened = false;
    let received = 0;
    source.addEventListener("open", () => {
      if (!opened) {
        opened = true;
        return;
      }
      const receivedBeforeRequest = received;
      void request<SessionView>(sessionPath(target)).then((view) => {
        if (generation === this.selectionGeneration && received === receivedBeforeRequest) this.applyView(view);
      }).catch((error: unknown) => {
        if (generation === this.selectionGeneration) console.error("Pi Station Session reconciliation failed", error);
      });
    });
    const receive = (message: MessageEvent<string>): void => {
      if (generation !== this.selectionGeneration) return;
      received += 1;
      const event = JSON.parse(message.data) as StreamEvent;
      this.applyEvent(event);
    };
    for (const type of ["phase", "assistant.delta", "thinking.delta", "tool", "timeline", "error"]) {
      source.addEventListener(type, receive as EventListener);
    }
  }

  private applyEvent(event: StreamEvent): void {
    const key = this.rpcState.selectedSessionKey;
    if (key === undefined) return;
    if (event.type === "phase") {
      this.setPhase(event.phase, event.epoch, event.generation);
      if (event.phase === "idle") {
        const generation = this.selectionGeneration;
        void this.refreshSharedFiles(targetFromKey(key), generation);
      }
      return;
    }
    if (event.type === "timeline") {
      this.rpcState = {
        ...this.rpcState,
        selected: {
          ...this.rpcState.selected,
          timeline: mapTimeline(event.timeline, key, "saved"),
        },
      };
      this.emitRpcState();
      return;
    }
    if (event.type === "error") {
      console.error("Pi Station turn failed", event.message);
      return;
    }

    const timeline = [...this.rpcState.selected.timeline];
    if (event.type === "tool") {
      const index = timeline.findIndex((item) => item.category === "tool-activity"
        && item.content.toolCallId === event.toolCallId);
      const content = {
        toolCallId: event.toolCallId,
        name: event.title,
        summary: toolSummary(event.title, event.inputText),
        ...(event.inputText === undefined ? {} : { inputText: event.inputText }),
        ...(event.outputText === undefined ? {} : { outputText: event.outputText }),
        state: event.state,
        truncated: false,
      };
      if (index >= 0) {
        const previous = timeline[index]!;
        timeline[index] = { ...previous, content: { ...previous.content, ...content } } as ApplicationTimelineItem;
      } else {
        timeline.push({
          timelineItemId: `tool-call-${event.toolCallId}`,
          sessionKey: key,
          source: "live",
          liveSequence: timeline.length,
          category: "tool-activity",
          content,
        } as unknown as ApplicationTimelineItem);
      }
    } else {
      const category = event.type === "assistant.delta" ? "assistant-response" : "thinking";
      const previous = timeline.at(-1);
      if (previous?.source === "live" && previous.category === category) {
        timeline[timeline.length - 1] = {
          ...previous,
          content: { ...previous.content, text: previous.content.text + event.text },
        } as typeof previous;
      } else {
        timeline.push({
          timelineItemId: `rpc-live-${category}-${timeline.length}`,
          sessionKey: key,
          source: "live",
          liveSequence: timeline.length,
          category,
          content: { text: event.text, state: "streaming" },
        });
      }
    }
    this.rpcState = { ...this.rpcState, selected: { ...this.rpcState.selected, timeline } };
    this.emitRpcState();
  }

  private async refreshSharedFiles(target: RpcTarget, generation: number): Promise<void> {
    try {
      const response = await request<SessionSharedFiles>(`${sessionPath(target)}/shared-files`);
      const key = this.rpcState.selectedSessionKey;
      if (generation !== this.selectionGeneration || key === undefined
        || key.hostId !== target.projectId || key.piSessionId !== target.sessionId) return;
      this.rpcState = {
        ...this.rpcState,
        selected: {
          ...this.rpcState.selected,
          details: { ...this.rpcState.selected.details, sharedFiles: response.sharedFiles },
        },
      } as unknown as ApplicationState;
      this.emitRpcState();
    } catch (error) {
      console.error("Pi Station shared files refresh failed", error);
    }
  }

  private setPhase(phase: SessionPhase, epoch?: string, generation?: number): void {
    const key = this.rpcState.selectedSessionKey;
    if (key === undefined || this.rpcState.selected.projection === undefined) return;
    const phaseKey = key.piSessionId;
    if (!this.acceptPhaseRevision(phaseKey, epoch, generation)) return;
    const run: "working" | "idle" = phase === "working" ? "working" : "idle";
    const projection = { ...this.rpcState.selected.projection, run };
    this.rpcState = {
      ...this.rpcState,
      selected: { ...this.rpcState.selected, projection },
      sessions: this.rpcState.sessions.map((session) => (
        session.sessionKey.hostId === key.hostId
          && session.sessionKey.piSessionId === key.piSessionId
          ? { ...session, projection: { ...session.projection, run } }
          : session
      )),
    };
    this.emitRpcState();
  }

  private acceptPhaseRevision(phaseKey: string, epoch?: string, generation?: number): boolean {
    const current = this.phaseRevisions.get(phaseKey);
    if (epoch === undefined) {
      if (current?.epoch !== undefined) return false;
      if (generation === undefined) return current === undefined;
      if (generation < (current?.generation ?? -1)) return false;
      this.phaseRevisions.set(phaseKey, { generation, seenEpochs: current?.seenEpochs ?? new Set() });
      return true;
    }

    if (current?.epoch === epoch) {
      if (generation === undefined || generation < current.generation) return false;
      this.phaseRevisions.set(phaseKey, { epoch, generation, seenEpochs: current.seenEpochs });
      return true;
    }
    if (current?.seenEpochs.has(epoch) === true) return false;

    const seenEpochs = new Set(current?.seenEpochs);
    if (current?.epoch !== undefined) seenEpochs.add(current.epoch);
    this.phaseRevisions.set(phaseKey, { epoch, generation: generation ?? 0, seenEpochs });
    return true;
  }

  private markSelectedAttentionRead(): void {
    if (!this.selectedVisible) return;
    const key = this.rpcState.selectedSessionKey;
    if (key === undefined) return;
    const summary = this.rpcState.sessions.find((session) => session.sessionKey.hostId === key.hostId
      && session.sessionKey.piSessionId === key.piSessionId);
    const attentionId = summary?.projection.unread.latestUnreadTurnId;
    if (summary?.projection.unread.hasUnread !== true || attentionId === undefined) return;
    const signature = `${key.hostId}:${key.piSessionId}:${attentionId}`;
    if (this.markReadSignature === signature) return;
    this.markReadSignature = signature;
    const target = targetFromKey(key);
    void mutate(`${sessionPath(target)}/read`, "POST", { attentionId }).then(() => {
      if (this.markReadSignature !== signature) return;
      this.markReadSignature = undefined;
      const unread = { hasUnread: false };
      this.rpcState = {
        ...this.rpcState,
        sessions: this.rpcState.sessions.map((session) => session.sessionKey.hostId === key.hostId
          && session.sessionKey.piSessionId === key.piSessionId
          ? { ...session, projection: { ...session.projection, unread } }
          : session),
        selected: this.rpcState.selectedSessionKey?.hostId === key.hostId
          && this.rpcState.selectedSessionKey.piSessionId === key.piSessionId
          ? { ...this.rpcState.selected, projection: { ...this.rpcState.selected.projection, unread } }
          : this.rpcState.selected,
      } as unknown as ApplicationState;
      this.emitRpcState();
    }).catch((error: unknown) => {
      if (this.markReadSignature === signature) this.markReadSignature = undefined;
      console.error("Pi Station read marker failed", error);
    });
  }

  private setRpcCommand(
    requestId: string,
    status: "queued" | "accepted" | "not-accepted" | "completed",
    succeeded = false,
    effect?: SucceededCommandEffect,
  ): void {
    const result = succeeded
      ? { requestId, outcome: { status: "succeeded", ...(effect === undefined ? {} : { effect }) } } as ApplicationCommandResult
      : undefined;
    this.rpcState = {
      ...this.rpcState,
      commands: {
        ...this.rpcState.commands,
        [requestId]: { requestId, status, ...(result === undefined ? {} : { result }) },
      },
    };
    this.emitRpcState();
  }

  private updateRpcState(change: Partial<ApplicationState>): void {
    this.rpcState = { ...this.rpcState, ...change };
    this.emitRpcState();
  }

  private emitRpcState(): void {
    for (const listener of this.rpcListeners) listener(this.rpcState);
  }
}

interface QuickSessionResponse { readonly session?: SavedSession; readonly action?: { readonly type: "clear" | "keep"; readonly status: "pending" | "failed"; readonly error?: string } }

function projectSummary(project: Project): ProjectSummary {
  return {
    projectId: project.id,
    name: project.name ?? project.root.split("/").at(-1) ?? project.root,
    displayPath: project.root,
    available: true,
    closed: (project as Project & { readonly closed?: boolean }).closed === true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

export function upsertSessionSummary(
  sessions: readonly SessionSummary[],
  saved: SavedSession,
): readonly SessionSummary[] {
  const changed = sessionSummary(saved);
  const key = changed.sessionKey;
  const retained = sessions.filter((session) => session.sessionKey.piSessionId !== key.piSessionId);
  return [changed, ...retained].sort((a, b) => (
    (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "")
  ));
}

function sessionSummary(session: SavedSession): SessionSummary {
  return {
    sessionKey: keyFromSession(session),
    name: session.name,
    displayPath: session.cwd ?? session.path,
    projectId: session.projectId,
    ...(session.parentSessionId === undefined ? {} : {
      parentSessionKey: keyFromSession({ ...session, id: session.parentSessionId }),
    }),
    lastActivityAt: session.modifiedAt,
    projection: projectionFor(session, session.delegationStatus === "working" ? "working" : "idle"),
    ...(session.delegationStatus === undefined ? {} : { delegationStatus: session.delegationStatus }),
    ...(session.pendingProjectMove === undefined ? {} : { pendingProjectMove: session.pendingProjectMove }),
    ...(session.quickSession === true ? { quickSession: true as const } : {}),
    ...(session.quickSessionPending === undefined ? {} : { quickSessionPending: session.quickSessionPending }),
  };
}

function projectionFor(session: SavedSession, phase: SessionPhase): SessionSummary["projection"] {
  return {
    availability: session.state === "open" ? "available" : "closed",
    synchronization: "synchronized",
    run: phase === "working" ? "working" : "idle",
    queue: { state: "empty", knownCount: 0 },
    unread: session.parentSessionId === undefined && session.unread?.hasUnread === true
      ? { hasUnread: true, ...(session.unread.latestAttentionId === undefined ? {} : { latestUnreadTurnId: session.unread.latestAttentionId }) }
      : { hasUnread: false },
    management: { kind: "unmanaged" },
    capabilities: session.state !== "open" ? [] : session.quickSession === true
      ? ["session.prompt.text", "session.prompt.steer", "session.prompt.follow-up", "session.abort", "session.model.set", "session.thinking.set"]
      : [...RPC_CAPABILITIES],
  };
}

export function mapTimeline(
  items: readonly RpcTimelineItem[],
  key: SessionKey,
  source: "saved" | "live",
): ApplicationTimelineItem[] {
  return items.map((item, index) => {
    const base = {
      timelineItemId: item.id,
      sessionKey: key,
      source,
      branchOrdinal: index,
      ...(item.timestamp === undefined ? {} : { createdAt: item.timestamp }),
    } as const;
    if (item.kind === "user") {
      const images = item.images?.map((image) => image.status === "available"
        ? { mediaType: image.mediaType, historyImageId: image.id }
        : { unavailable: true as const });
      const attachments = item.attachments;
      return {
        ...base,
        category: "user-message",
        content: { text: item.text, ...(images === undefined || images.length === 0 ? {} : { images }), ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }) },
      };
    }
    if (item.kind === "agent") {
      return {
        ...base,
        category: "agent-message",
        content: { from: item.fromName ?? `Session ${item.fromSessionId}`, text: item.text },
      };
    }
    if (item.kind === "scheduled-job") {
      return { ...base, category: "scheduled-job", content: { jobId: item.jobId, title: item.title, prompt: item.text } };
    }
    if (item.kind === "assistant") {
      return { ...base, category: "assistant-response", content: { text: item.text, state: "complete" } };
    }
    if (item.kind === "context-summary") {
      return { ...base, category: "context-summary", content: { summaryType: item.summaryType, text: item.text } };
    }
    if (item.kind === "thinking") {
      return { ...base, category: "thinking", content: { text: item.text, state: "complete" } };
    }
    if (item.kind === "tool") {
      return {
        ...base,
        category: "tool-activity",
        content: {
          toolCallId: item.toolCallId ?? item.id,
          name: item.title,
          summary: toolSummary(item.title, item.inputText),
          ...(item.inputText === undefined ? {} : { inputText: item.inputText }),
          ...(item.text === "" ? {} : { outputText: item.text }),
          state: item.state ?? "succeeded",
          truncated: false,
        },
      };
    }
    return {
      ...base,
      category: "extension-message",
      content: { sourceName: "Pi", text: item.text },
    };
  });
}

export function toolSummary(title: string, inputText?: string): string {
  if (title !== "delegate_to_agent" || inputText === undefined) return title;
  try {
    const input = JSON.parse(inputText) as { model?: { provider?: unknown; modelId?: unknown } };
    return typeof input.model?.provider === "string" && typeof input.model.modelId === "string"
      ? `${title} · ${input.model.provider}/${input.model.modelId}`
      : title;
  } catch {
    return title;
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<T>;
}

async function mutate(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.status === 204 ? undefined : response.json() as Promise<unknown>;
}

async function responseError(response: Response): Promise<string> {
  try {
    const value = await response.json() as { error?: unknown };
    if (typeof value.error === "string") return value.error;
  } catch {
    // Use the stable fallback below for non-JSON failures.
  }
  return `Pi Station request failed (${response.status})`;
}
