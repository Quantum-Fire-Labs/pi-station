import type {
  ModelChoice,
  SharedFileInfo,
  ThinkingLevel,
  TimelineAttachment,
  Workspace,
  WorkspaceState,
} from "@pi-station/application-protocol";

/** UI projection derived from the normalized /v2 application protocol. */
export interface SessionKey { readonly hostId: string; readonly piSessionId: string }
export type ProjectId = string;
export type CapabilityId = string;
export type SavedWorkspace = Workspace;
export type WorkspaceCollection = WorkspaceState;

export interface ProjectSummary { readonly projectId: ProjectId; readonly name: string; readonly displayPath: string; readonly available: boolean; readonly closed?: boolean; readonly createdAt: string; readonly updatedAt: string }
export interface ProjectBookmark { readonly projectId: ProjectId; readonly position: number }
export interface SessionBookmark { readonly projectId: ProjectId; readonly sessionKey: SessionKey; readonly position: number }
export interface SessionProjection {
  readonly availability: "unknown" | "available" | "reconnecting" | "closed" | "unavailable";
  readonly synchronization: "not-applicable" | "synchronized" | "resyncing" | "failed";
  readonly run: "unknown" | "idle" | "working" | "aborting" | "settling";
  readonly queue: { readonly state: "unknown" | "empty" | "known-items" | "external-pending" | "mixed"; readonly knownCount: number };
  readonly unread: { readonly hasUnread: boolean; readonly latestUnreadTurnId?: string; readonly unreadCount?: number };
  readonly management: { readonly kind: "unmanaged" } | { readonly kind: "managed"; readonly managedSessionId: string; readonly runner: string; readonly processState: string; readonly safeFailure?: string };
  readonly capabilities: readonly CapabilityId[];
}
export interface SessionSummary { readonly sessionKey: SessionKey; readonly parentSessionKey?: SessionKey; readonly name?: string | undefined; readonly displayPath?: string; readonly projectId?: ProjectId; readonly quickSession?: true; readonly quickSessionPending?: "clear" | "keep"; readonly generationId?: string; readonly projection: SessionProjection; readonly createdAt?: string; readonly lastActivityAt?: string; readonly delegationStatus?: "working" | "completed" | "failed" | "cancelled" | "interrupted"; readonly pendingProjectMove?: { readonly projectId: string; readonly projectName: string } }
export function sessionsVisibleInWorkspace(sessions: readonly SessionSummary[], includeQuickSession = false): readonly SessionSummary[] {
  return includeQuickSession ? sessions : sessions.filter(({ quickSession }) => quickSession !== true);
}
export interface SessionDetails { readonly name?: string | undefined; readonly currentDirectoryDisplay?: string | undefined; readonly projectId?: ProjectId | undefined; readonly model?: ModelChoice; readonly modelInventory?: readonly ModelChoice[]; readonly thinkingLevel?: ThinkingLevel; readonly supportedThinkingLevels?: readonly ThinkingLevel[]; readonly managedLaunchDisplay?: string; readonly sharedFiles?: readonly SharedFileInfo[]; readonly commandInventory: readonly { readonly name: string; readonly description?: string; readonly source: "extension" | "prompt-template" | "skill"; readonly invocation: "prompt" | "direct"; readonly requiredCapability?: CapabilityId }[] }
export interface ApplicationQueueSnapshot { readonly state: SessionProjection["queue"]["state"]; readonly knownItems: readonly never[] }
export type TimelineSource = "saved" | "live" | "optimistic";
export type TimelineImage =
  | { readonly mediaType: "image/png" | "image/jpeg" | "image/webp"; readonly data: string }
  | { readonly mediaType: "image/png" | "image/jpeg" | "image/webp"; readonly historyImageId: string }
  | { readonly unavailable: true };
interface TimelineBase { readonly timelineItemId: string; readonly sessionKey: SessionKey; readonly source: TimelineSource; readonly branchOrdinal?: number; readonly branchPartOrdinal?: number; readonly liveSequence?: number; readonly createdAt?: string }
export type TimelineItem =
  | (TimelineBase & { readonly category: "user-message"; readonly content: { readonly text: string; readonly images?: readonly TimelineImage[]; readonly attachments?: readonly TimelineAttachment[] } })
  | (TimelineBase & { readonly category: "assistant-response"; readonly content: { readonly text: string; readonly state: "streaming" | "complete" | "interrupted" | "error" } })
  | (TimelineBase & { readonly category: "thinking"; readonly content: { readonly text: string; readonly state: "streaming" | "complete" | "interrupted" } })
  | (TimelineBase & { readonly category: "tool-activity"; readonly content: { readonly toolCallId: string; readonly name: string; readonly summary: string; readonly inputText?: string; readonly outputText?: string; readonly state: "pending" | "running" | "succeeded" | "failed" | "interrupted" | "aborted"; readonly truncated: boolean } })
  | (TimelineBase & { readonly category: "context-summary"; readonly content: { readonly summaryType: "compaction" | "branch"; readonly text: string } })
  | (TimelineBase & { readonly category: "agent-message"; readonly content: { readonly from?: string; readonly to?: string; readonly text: string } })
  | (TimelineBase & { readonly category: "extension-message"; readonly content: { readonly sourceName: string; readonly text: string } })
  | (TimelineBase & { readonly category: "scheduled-job"; readonly content: { readonly jobId: string; readonly title: string; readonly prompt: string } })
  | (TimelineBase & { readonly category: "notice"; readonly content: { readonly level: "info" | "warning" | "error"; readonly text: string } });

export type CommandAction =
  | { readonly kind: "prompt.send" | "prompt.steer" | "prompt.follow-up"; readonly text: string; readonly imageIds?: readonly string[]; readonly attachmentIds?: readonly string[]; readonly agentMentions?: readonly { readonly sessionId: string; readonly label: string }[] }
  | { readonly kind: "session.abort" | "session.close" | "session.clone" | "session.reload" | "session.queue.clear" }
  | { readonly kind: "session.undo"; readonly entryId: string }
  | { readonly kind: "session.move"; readonly projectId: string }
  | { readonly kind: "session.move.cancel" }
  | { readonly kind: "session.rename"; readonly name: string }
  | { readonly kind: "session.model.set"; readonly provider: string; readonly modelId: string }
  | { readonly kind: "session.thinking.set"; readonly level: ThinkingLevel };
export interface ApplicationError { readonly requestId?: string; readonly code: string; readonly message: string; readonly retryable: boolean }
export type CommandEffect = { readonly kind: "prompt-committed"; readonly timelineItemId?: string } | { readonly kind: "queue-item-created"; readonly queueItemId: string } | { readonly kind: "abort-accepted" | "close-accepted" | "reload-accepted" } | { readonly kind: "clone-created"; readonly piSessionId: string } | { readonly kind: "rename-applied"; readonly name: string } | { readonly kind: "model-applied"; readonly provider: string; readonly modelId: string } | { readonly kind: "thinking-applied"; readonly level: ThinkingLevel };
export type CommandOutcome = { readonly status: "succeeded"; readonly effect: CommandEffect } | { readonly status: "rejected" | "retryable" | "outcome-unknown"; readonly error: ApplicationError } | { readonly status: "stale-generation"; readonly currentGenerationId?: string };
export interface ApplicationCommandResult { readonly requestId: string; readonly outcome: CommandOutcome }
export interface ApplicationCommand { readonly requestId: string; readonly sessionKey: SessionKey; readonly expectedGenerationId: string; readonly action: CommandAction }
export type GenericOutcome<T = Record<string, unknown>> = ({ readonly status: "succeeded" } & T) | { readonly status: "rejected" | "retryable"; readonly error: ApplicationError };
export interface DevelopmentServerConfiguration { readonly command: string; readonly previewPort?: number }
export interface DevelopmentServerState { readonly projectId: ProjectId; readonly lifecycle: "stopped" | "starting" | "running" | "stopping" | "failed"; readonly configuration?: DevelopmentServerConfiguration; readonly previewUrl?: string; readonly safeFailure?: string }
export type BookmarkMutationResult = { readonly outcome: GenericOutcome };
export type ProjectCreateResult = { readonly outcome: GenericOutcome<{ readonly project: ProjectSummary }> };
export type ProjectClosedSessionsListOutcome = GenericOutcome<{ readonly sessions: readonly SessionSummary[] }>;
export interface DirectoryEntry { readonly name: string; readonly path: string; readonly displayPath: string }
export type DirectoryListResult = { readonly outcome: GenericOutcome<{ readonly current: DirectoryEntry; readonly parent?: DirectoryEntry; readonly directories: readonly DirectoryEntry[] }> };
export type ManagedSessionCreateOutcome = GenericOutcome<{ readonly session?: SessionSummary; readonly sessionKey: SessionKey }> | { readonly status: "outcome-unknown"; readonly error: ApplicationError };
export type ManagedSessionRestartOutcome = GenericOutcome<{ readonly session?: SessionSummary; readonly sessionKey: SessionKey; readonly generationId?: string }> | { readonly status: "outcome-unknown"; readonly error: ApplicationError };
export type DevelopmentServerResult = { readonly outcome: GenericOutcome<{ readonly state?: DevelopmentServerState }> };
export type DevelopmentServerOutputResult = { readonly outcome: GenericOutcome<{ readonly output?: string }> };
export type { ModelChoice, ThinkingLevel };
