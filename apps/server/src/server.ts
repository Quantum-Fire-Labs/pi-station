import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, extname, relative, resolve, sep } from "node:path"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { initializeEmptySession } from "./empty-session.js"
import type { AgentMessagingBridge } from "./agent-messaging.js"
import type { NewAgentInProjectBridge } from "./new-agent-in-project.js"
import type { SessionRuntime } from "./session-runtime.js"
import {
  encodeSse,
  isAuthLoginRequest,
  isAuthPromptResponse,
  isGeneratedSessionId,
  isModelSettingRequest,
  isNewTurnRequest,
  isCreateMessageStashRequest,
  isProjectRootsRequest,
  isProjectName,
  isPrompt,
  isProtocolId,
  isSessionMoveRequest,
  isSessionStateRequest,
  isIanaTimezone,
  isScheduledJobMutation,
  isThinkingSettingRequest,
  isUpdateChannelMutation,
  isWorkspaceCreateMutation,
  isWorkspaceOpenSessionMutation,
  isWorkspaceReorderTabsMutation,
  isWorkspaceUpdateMutation,
  PROTOCOL_VERSION,
} from "@pi-station/application-protocol"
import type { CommandSummary, ModelChoice, Project, SavedSession, ScheduledJob, SessionKey, SessionSettings, ThinkingLevel } from "@pi-station/application-protocol"
import { projectId as stableProjectId, StaleHistoryCursorError, type SessionIndex } from "./domain.js"
import { DelegationStore } from "./delegations.js"
import type { DelegationEvents } from "./delegations.js"
import { EventJournal } from "./event-journal.js"
import { SessionFileWatcher } from "./session-file-watcher.js"
import { ImageUploadStore, imageMediaType, readImageBody } from "./image-uploads.js"
import {
  assertAllowedOrigin,
  assertJsonMutation,
  HttpError,
  readJsonBody,
  sendError,
  sendJson,
  sendOptions,
  WEB_ORIGIN,
} from "./http.js"
import { ProjectBookmarkStore } from "./project-bookmarks.js"
import { ProjectStore } from "./project-store.js"
import { WorkspaceStore, WorkspaceStoreError } from "./workspace-store.js"
import { SessionBookmarkStore } from "./session-bookmarks.js"
import { isSessionDefaults, normalizeSessionDefaults, SessionDefaultsStore } from "./session-defaults.js"
import { SessionMetadataStore } from "./session-metadata.js"
import { serveProjectMarkdown, SharedFileError, type SharedFileService } from "./shared-files.js"
import { SessionUpdates } from "./session-updates.js"
import { TurnService } from "./turn-service.js"
import { maintenanceIsActive } from "./maintenance.js"
import {
  NotificationInputError,
  NotificationPresenceStore,
  NotificationRepository,
  NotificationService,
  type PushSender,
} from "./notification-service.js"
import { SessionAttentionStore } from "./session-attention.js"
import { allowsDirectNotification } from "./notification-policy.js"
import type { SavedTimelineImage } from "./session-images.js"
import { ScheduledJobError, ScheduledJobScheduler, ScheduledJobStore, SettingsStore } from "./scheduled-jobs.js"
import { SessionAttachmentStore, attachmentMarker, attachmentPrompt } from "./session-attachments.js"
import { MessageStashStore } from "./message-stashes.js"
import type { ScheduledJobAgentBridge } from "./scheduled-jobs.js"
import { VoiceSettingsError, VoiceSettingsStore } from "./voice-settings.js"
import { SystemThemeService } from "./system-theme.js"
import { rewriteSessionCwd, type SessionMoveAgentBridge } from "./session-moves.js"
import { QuickSessionStore, QUICK_SESSION_PROJECT_ID } from "./quick-session.js"
import { ProviderAuthError, type ProviderAuthService } from "./provider-auth.js"
import type { PiStationUpdater } from "./updater.js"
import type { CommandApprovalService } from "./command-approval.js"

const HOST = "127.0.0.1"
const shutdownContexts = new WeakMap<Server, { shutdown: (timeoutMs: number) => Promise<void> }>()

export interface SessionDefaultModel {
  readonly provider: string
  readonly modelId: string
  readonly displayName?: string
}

export interface PiStationServerOptions {
  readonly dataDir: string
  readonly index: SessionIndex
  readonly runner: SessionRuntime
  readonly delegationStore?: DelegationStore
  readonly delegationEvents?: DelegationEvents
  readonly sessionDefaults?: SessionDefaultsStore
  readonly sessionDefaultModels?: () => readonly SessionDefaultModel[]
  readonly notificationSender?: PushSender
  readonly sharedFiles?: SharedFileService
  readonly scheduledJobStore?: ScheduledJobStore
  readonly settingsStore?: SettingsStore
  readonly systemThemeService?: SystemThemeService
  readonly scheduledJobAgentBridge?: ScheduledJobAgentBridge
  readonly agentMessaging?: AgentMessagingBridge
  readonly sessionMoves?: SessionMoveAgentBridge
  readonly newAgentInProject?: NewAgentInProjectBridge
  readonly providerAuth?: ProviderAuthService
  readonly updater?: PiStationUpdater
  readonly commandApprovals?: CommandApprovalService
  readonly webRoot?: string
  /** Test seam that prevents server tests from writing into Pi's global Session directory. */
  readonly initializeSession?: (cwd: string, sessionId: string, name?: string) => void
  /** Test seam for the opaque process epoch. Production uses a random UUID. */
  readonly phaseEpoch?: string
}

export function createPiStationServer(options: PiStationServerOptions): Server {
  const phaseEpoch = options.phaseEpoch ?? randomUUID()
  const initializeSession = options.initializeSession ?? ((cwd: string, sessionId: string, name?: string) => {
    initializeEmptySession(SessionManager.create(cwd, undefined, { id: sessionId }), name)
  })
  const projectStore = new ProjectStore(options.dataDir)
  const projectBookmarks = new ProjectBookmarkStore(options.dataDir)
  let workspaceMigrationSessions: () => Promise<readonly SavedSession[]> = () => Promise.resolve([])
  const workspaceStore = new WorkspaceStore(options.dataDir, () => workspaceMigrationSessions())
  const ensureProjectOpen = async (projectId: string): Promise<void> => projectStore.ensureOpen(projectId)
  const metadata = new SessionMetadataStore(options.dataDir)
  const sessionBookmarks = new SessionBookmarkStore(options.dataDir)
  const sessionDefaults = options.sessionDefaults ?? new SessionDefaultsStore(options.dataDir)
  const journal = new EventJournal()
  const sessionUpdates = new SessionUpdates()
  const sessionFiles = new SessionFileWatcher()
  const attentionStore = new SessionAttentionStore(options.dataDir)
  const attachments = new SessionAttachmentStore(options.dataDir)
  const notificationRepository = new NotificationRepository(options.dataDir)
  const notificationPresence = new NotificationPresenceStore()
  const notifications = new NotificationService(
    options.dataDir,
    notificationRepository,
    notificationPresence,
    options.notificationSender,
  )
  const imageUploads = new ImageUploadStore()
  const messageStashes = new MessageStashStore(options.dataDir, attachments, imageUploads)
  const delegationStore = options.delegationStore ?? new DelegationStore(options.dataDir)
  const settings = options.settingsStore ?? new SettingsStore(options.dataDir)
  const scheduledJobs = options.scheduledJobStore ?? new ScheduledJobStore(options.dataDir)
  const voiceSettings = new VoiceSettingsStore(options.dataDir)
  const systemTheme = options.systemThemeService ?? new SystemThemeService()
  const quickSessions = new QuickSessionStore(options.dataDir, undefined)
  type QuickAction = { readonly token: string; readonly type: "clear" | "keep"; readonly status: "pending" } | { readonly token: string; readonly type: "clear" | "keep"; readonly status: "failed"; readonly error: string }
  const quickActions = new Map<string, QuickAction>()
  const disassociatedProjects = new Map<string, Project>()
  const pendingSessionMoves = new Map<string, { readonly projectId: string; readonly projectName: string }>()
  const eventStreams = new Set<ServerResponse>()
  let acceptingWork = true
  let shutdownStarted = false
  let disposed = false

  const decorateDelegations = async (listed: readonly SavedSession[]): Promise<readonly SavedSession[]> => {
    const delegations = await delegationStore.byChild()
    return listed.map((session) => {
      const delegation = delegations.get(session.id)
      return delegation === undefined ? session : { ...session, parentSessionId: delegation.parentSessionId, delegationStatus: delegation.status }
    })
  }

  const decorateSessions = async (listed: readonly SavedSession[]): Promise<readonly SavedSession[]> => {
    const decorated = await attentionStore.decorate(await decorateDelegations(listed))
    return decorated.map((session) => {
      const pendingProjectMove = pendingSessionMoves.get(session.id)
      return pendingProjectMove === undefined ? session : { ...session, pendingProjectMove }
    })
  }

  const sessions = async (): Promise<readonly SavedSession[]> => {
    const ordinary = await metadata.decorate(await options.index.list(await projectStore.read()))
    const quickRecord = await quickSessions.read()
    const quick = quickRecord === undefined ? undefined : await quickSessions.saved(quickRecord)
    const action = quick === undefined ? undefined : quickActions.get(quick.id)
    const listed = quick === undefined ? ordinary : [...ordinary.filter(({ id }) => id !== quick.id), { ...quick, ...(action?.status === "pending" ? { quickSessionPending: action.type } : {}) }]
    return decorateSessions(listed)
  }
  workspaceMigrationSessions = sessions

  const findSession = async (key: SessionKey): Promise<SavedSession | undefined> => {
    if (key.projectId === QUICK_SESSION_PROJECT_ID) {
      const record = await quickSessions.read()
      if (record?.sessionId !== key.sessionId) return undefined
      const quick = await quickSessions.saved(record)
      const action = quick === undefined ? undefined : quickActions.get(quick.id)
      return quick === undefined ? undefined : (await decorateSessions([{ ...quick, ...(action?.status === "pending" ? { quickSessionPending: action.type } : {}) }]))[0]
    }
    const indexed = await options.index.get(key, await projectStore.read())
    if (indexed === undefined) return undefined
    return (await decorateSessions(await metadata.decorate([indexed])))[0]
  }

  const resolveProject = async (key: SessionKey, saved?: SavedSession): Promise<Project> => {
    const projectId = saved?.projectId ?? key.projectId
    if (projectId === QUICK_SESSION_PROJECT_ID) {
      const record = await quickSessions.read()
      if (record?.sessionId === key.sessionId) return quickSessions.project(record)
    }
    const configured = (await projectStore.read()).find((project) => project.id === projectId)
    if (configured !== undefined) return configured
    const cwd = (saved as SavedSession & { readonly cwd?: string } | undefined)?.cwd
    if (cwd !== undefined && stableProjectId(cwd) === projectId) {
      return { id: projectId, root: cwd }
    }
    throw new HttpError(404, "Project not found")
  }

  const publishSession = async (saved: SavedSession): Promise<SavedSession> => {
    const decorated = (await decorateSessions([saved]))[0]!
    sessionUpdates.publish(decorated)
    return decorated
  }

  const unsubscribeCommandApprovals = options.commandApprovals?.subscribe((event) => {
    const key = { projectId: event.approval.projectId, sessionId: event.approval.sessionId }
    journal.publish(key, {
      version: 2,
      type: "command.approval",
      approval: event.type === "requested"
        ? event.approval.kind === "command"
          ? { id: event.approval.id, kind: "command", command: event.approval.command }
          : { id: event.approval.id, kind: "delegation", model: event.approval.model, thinkingLevel: event.approval.thinkingLevel }
        : null,
    })
  })

  const turns = new TurnService(
    options.runner,
    (key, event) => {
      journal.publish(key, event)
      if (event.type === "phase") {
        sessionUpdates.publishPhase({
          projectId: key.projectId,
          sessionId: key.sessionId,
          phase: event.phase,
          epoch: event.epoch ?? phaseEpoch,
          generation: event.generation ?? turns.phase(key).generation,
        })
      }
    },
    async (attention) => {
      if (!await attentionStore.record(attention, attention.id)) return
      const saved = await findSession(attention)
      if (saved !== undefined) await publishSession(saved)
      if (await allowsDirectNotification(attention, delegationStore)) {
        await notifications.notify({
          ...attention,
          ...(saved?.name === undefined ? {} : { sessionName: saved.name }),
        })
      }
    },
    phaseEpoch,
  )

  const applySessionMove = async (sessionId: string): Promise<SavedSession | undefined> => {
    const pending = pendingSessionMoves.get(sessionId)
    if (pending === undefined) return undefined
    const saved = (await sessions()).find((session) => session.id === sessionId)
    const project = (await projectStore.read()).find((item) => item.id === pending.projectId)
    if (saved === undefined || project === undefined) { pendingSessionMoves.delete(sessionId); throw new Error("Move target Project is unavailable") }
    if (saved.projectId === project.id) { pendingSessionMoves.delete(sessionId); return publishSession(saved) }
    await rewriteSessionCwd(saved.path, project.root)
    const moved = await options.index.indexSession({ ...saved, projectId: project.id, cwd: project.root, modifiedAt: new Date().toISOString() })
    pendingSessionMoves.delete(sessionId)
    await turns.control({ projectId: project.id, sessionId }, moved.path, project.root, { type: "reload" })
    return publishSession({ ...moved, state: saved.state })
  }

  const requestSessionMove = async (sessionId: string, projectId: string) => {
    const saved = (await sessions()).find((session) => session.id === sessionId)
    if (saved === undefined) throw new Error("Session not found")
    const project = (await projectStore.read()).find((item) => item.id === projectId)
    if (project === undefined) throw new Error("Target Project is not configured")
    if (saved.projectId === project.id) return { status: "unchanged" as const, projectId: project.id, projectName: project.name ?? project.root }
    const pending = { projectId: project.id, projectName: project.name ?? project.root }
    pendingSessionMoves.set(sessionId, pending)
    await publishSession(saved)
    const key = { projectId: saved.projectId, sessionId }
    if (!turns.isWorking(key)) await applySessionMove(sessionId)
    return { status: turns.isWorking(key) ? "scheduled" as const : "moved" as const, ...pending }
  }

  turns.onSessionIdle((key) => { if (pendingSessionMoves.has(key.sessionId)) void applySessionMove(key.sessionId).catch((error) => console.error(JSON.stringify({ event: "pi-station.session-move-failed", sessionId: key.sessionId, message: error instanceof Error ? error.message : "unknown" }))) })
  options.sessionMoves?.bind(async ({ sessionId, projectId }) => {
    const result = await requestSessionMove(sessionId, projectId)
    return { status: result.status === "unchanged" ? "unchanged" : "scheduled", projectId: result.projectId, projectName: result.projectName }
  })

  const settledTimeline = (key: SessionKey, project: Project) => async () => {
    const indexed = await options.index.refreshSession(key, project)
    if (indexed === undefined) throw new Error("Settled Session was not indexed")
    const saved = (await metadata.decorate([indexed]))[0]
    if (saved === undefined) throw new Error("Settled Session metadata was unavailable")
    await publishSession(saved)
    return options.index.timeline(indexed)
  }

  options.newAgentInProject?.bind(async (input) => {
    let project = (await projectStore.read()).find((item) => item.id === input.projectId)
    if (project === undefined) throw new Error(`Project not found: ${input.projectId}`)
    if (!isProjectName(input.name)) throw new Error("Session name is invalid")
    let root: Awaited<ReturnType<typeof stat>>
    try {
      root = await stat(project.root)
    } catch {
      throw new Error(`Project is unavailable: ${input.projectId}`)
    }
    if (!root.isDirectory()) throw new Error(`Project is unavailable: ${input.projectId}`)

    const sessionId = randomUUID()
    const key = { projectId: project.id, sessionId }
    await ensureProjectOpen(project.id)
    project = (await projectStore.read()).find((item) => item.id === input.projectId) ?? project
    initializeSession(project.root, sessionId, input.name)
    const indexed = await options.index.refreshSession(key, project)
    if (indexed === undefined) throw new Error("Created Session was not indexed")
    await metadata.set(key, "open")
    await publishSession({ ...indexed, state: "open" })
    try {
      const started = turns.startTracked({
        ...key,
        cwd: project.root,
        prompt: input.prompt,
        mode: "existing",
        sessionPath: indexed.path,
        settledTimeline: settledTimeline(key, project),
      })
      if (!started.accepted) throw new Error("New Session did not accept the prompt")
    } catch (error) {
      await metadata.set(key, "closed").catch(() => undefined)
      await publishSession({ ...indexed, state: "closed" }).catch(() => undefined)
      throw error
    }
    return { status: "started", sessionId, projectId: project.id }
  })

  options.agentMessaging?.bind(async (input) => {
    const matches = (await sessions()).filter((session) => session.id === input.sessionId && session.state === "open")
    if (matches.length === 0) throw new Error(`Open Session not found: ${input.sessionId}`)
    if (matches.length > 1) throw new Error(`Session ID is not unique: ${input.sessionId}`)
    const target = matches[0]!
    const key = { projectId: target.projectId, sessionId: target.id }
    const source = (await sessions()).find((session) => session.id === input.fromSessionId)
    const message = {
      fromSessionId: input.fromSessionId,
      ...(source?.name === undefined ? {} : { fromName: source.name }),
      message: input.message,
    }
    const project = await resolveProject(key, target)
    if (turns.isWorking(key)) {
      if (await turns.sendAgentMessage(key, message)) return { delivery: "steer" }
      if (await options.runner.sendAgentMessage?.({ sessionId: target.id, cwd: project.root, message })) return { delivery: "steer" }
      throw new Error("Target Session stopped before the message could steer it")
    }
    const started = turns.startTracked({
      ...key,
      cwd: project.root,
      prompt: input.message,
      agentMessage: message,
      mode: "existing",
      sessionPath: target.path,
      settledTimeline: settledTimeline(key, project),
    })
    if (!started.accepted) {
      if (await turns.sendAgentMessage(key, message)) return { delivery: "steer" }
      if (await options.runner.sendAgentMessage?.({ sessionId: target.id, cwd: project.root, message })) return { delivery: "steer" }
      throw new Error("Target Session did not accept the message")
    }
    return { delivery: "turn" }
  })

  const scheduledTurn = async (job: ScheduledJob) => {
    const project = (await projectStore.read()).find((item) => item.id === job.projectId)
    if (project === undefined) return { status: "failed" as const, message: "Project is missing" }
    await ensureProjectOpen(project.id)
    const sessionId = job.target.type === "new-session" ? randomUUID() : job.target.sessionId
    const key = { projectId: project.id, sessionId }
    const saved = job.target.type === "new-session" ? undefined : await findSession(key)
    if (job.target.type === "existing-session" && saved === undefined) return { status: "failed" as const, message: "Fixed Session is missing" }
    if (saved?.state === "closed") return { status: "failed" as const, message: "Fixed Session is closed" }
    if (turns.isWorking(key)) return { status: "busy" as const, message: "Fixed Session is busy; one retry is pending" }
    if (saved === undefined) await metadata.set(key, "open")
    const started = turns.startTracked({ ...key, cwd: project.root, prompt: job.prompt, origin: { kind: "scheduled-job", jobId: job.id, title: job.title }, mode: saved === undefined ? "new" : "existing", ...(saved === undefined ? { name: job.title } : { sessionPath: saved.path }), settledTimeline: settledTimeline(key, project) })
    return started.accepted ? { status: "started" as const, sessionId, ...(started.completion === undefined ? {} : { completion: started.completion }) } : { status: "busy" as const, message: "Fixed Session is busy; one retry is pending" }
  }
  const scheduler = new ScheduledJobScheduler(scheduledJobs, scheduledTurn)
  options.scheduledJobAgentBridge?.bind(async (action, input) => {
    const id = typeof input.id === "string" ? input.id : ""
    if (action === "list") return scheduledJobs.list(typeof input.projectId === "string" ? input.projectId : undefined)
    if (action === "get") { const job = await scheduledJobs.get(id); if (job === undefined) throw new ScheduledJobError("not-found", "Scheduled Job not found"); return job }
    if (action === "delete") { await scheduledJobs.delete(id); return { deleted: true } }
    if (action === "pause" || action === "resume") return scheduledJobs.setState(id, action === "pause" ? "paused" : "active", typeof input.actor === "string" ? input.actor : undefined)
    if (action === "run-now") { const job = await scheduledJobs.get(id); if (job === undefined) throw new ScheduledJobError("not-found", "Scheduled Job not found"); return scheduler.run(job, "run-now") }
    const projectId = typeof input.projectId === "string" ? input.projectId : ""
    const mutation = input.mutation
    if (!isProtocolId(projectId) || !isScheduledJobMutation(mutation)) throw new ScheduledJobError("invalid", "Scheduled Job mutation is invalid")
    await findProject(projectStore, projectId)
    return action === "create" ? scheduledJobs.create(projectId, mutation, (await settings.read()).timezone) : scheduledJobs.update(id, mutation, (await settings.read()).timezone)
  })
  scheduler.start()

  const unsubscribeDelegatedTurns = options.delegationEvents?.subscribeTurns((event) => {
    const key = { projectId: event.record.projectId, sessionId: event.record.childSessionId }
    if (event.type === "started") {
      turns.delegatedStarted(key)
      return
    }
    if (event.type === "runtime-event") {
      turns.delegatedEvent(key, event.event)
      return
    }
    void (async () => {
      const project = (await projectStore.read()).find((item) => item.id === event.record.projectId)
        ?? disassociatedProjects.get(event.record.projectId)
      if (project === undefined) {
        await turns.delegatedFinished({ key, settledTimeline: () => Promise.reject(new Error("Delegated Session Project is unavailable")), ...(event.error === undefined ? {} : { error: event.error }) })
        return
      }
      await turns.delegatedFinished({ key, settledTimeline: settledTimeline(key, project), ...(event.error === undefined ? {} : { error: event.error }) })
    })()
  })

  const unsubscribeDelegations = options.delegationEvents?.subscribe((event) => {
    void (async () => {
      await delegationStore.put(event.record)
      if (event.type === "started") await ensureProjectOpen(event.record.projectId)
      const project = (await projectStore.read()).find((item) => item.id === event.record.projectId)
      if (project === undefined) return
      const indexed = await options.index.indexSession({
        id: event.record.childSessionId,
        projectId: project.id,
        path: event.record.childPath,
        name: event.record.name ?? "Delegated Session",
        modifiedAt: event.record.updatedAt,
      })
      await publishSession({
        ...indexed,
        state: event.type === "closed" ? "closed" : "open",
        parentSessionId: event.record.parentSessionId,
        delegationStatus: event.record.status,
      })
    })()
  })

  // Persisted status is not proof of runtime ownership. A new server owns no
  // pre-existing delegated runtime, so reconcile before serving Session state.
  const startupReconciliation = (async () => {
    const interrupted = await delegationStore.interruptWorking()
    const projects = await projectStore.read()
    for (const record of interrupted) {
      const project = projects.find((item) => item.id === record.projectId)
      if (project === undefined) continue
      const indexed = await options.index.indexSession({
        id: record.childSessionId,
        projectId: record.projectId,
        path: record.childPath,
        name: record.name ?? "Delegated Session",
        modifiedAt: record.updatedAt,
      })
      await publishSession({ ...indexed, state: "open", parentSessionId: record.parentSessionId, delegationStatus: "interrupted" })
    }
  })()

  // Node accepts an async listener, but its callback type does not model the returned promise.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = createServer(async (request, response) => {
    try {
      await startupReconciliation
      assertAllowedOrigin(request)
      const url = new URL(request.url ?? "/", `http://${HOST}`)
      const updating = await maintenanceIsActive(options.dataDir)

      if (!acceptingWork && request.method !== "GET") {
        sendJson(response, 503, { error: "Pi Station is shutting down", retryable: true })
        return
      }

      if (request.method === "OPTIONS") {
        sendOptions(response)
        return
      }
      if (request.method === "GET" && url.pathname === "/maintenancez") {
        response.setHeader("cache-control", "no-store")
        sendJson(response, 200, { updating })
        return
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        response.setHeader("cache-control", "no-store")
        sendJson(response, 200, {
          status: "ok",
          version: PROTOCOL_VERSION,
          activeTurns: turns.workingCount,
          updating,
        })
        return
      }
      if (updating && url.pathname.startsWith("/v2/") && request.method !== "GET") {
        sendJson(response, 503, { error: "Pi Station is updating", retryable: true })
        return
      }
      if (url.pathname.startsWith("/shared/") && options.sharedFiles !== undefined) {
        try {
          await options.sharedFiles.serve(url.pathname.slice("/shared/".length), request, response)
        } catch (error) {
          sendSharedFileError(response, error)
        }
        return
      }
      const projectFileRoute = /^\/project-files\/([^/]+)\/([^/]+)$/u.exec(url.pathname)
      if (projectFileRoute !== null) {
        try {
          const key = { projectId: decodeURIComponent(projectFileRoute[1]!), sessionId: decodeURIComponent(projectFileRoute[2]!) }
          const saved = await findSession(key)
          if (saved === undefined || saved.projectId !== key.projectId) throw new SharedFileError(404)
          const project = await resolveProject(key, saved)
          const path = url.searchParams.get("path")
          if (path === null) throw new SharedFileError(400)
          if ((request.method === "GET" || request.method === "HEAD") && !url.searchParams.has("raw") && !url.searchParams.has("watch")) {
            const editorUrl = `/shared-editor?file=${encodeURIComponent(`${url.pathname}?path=${encodeURIComponent(path)}`)}`
            response.writeHead(302, { location: editorUrl, "cache-control": "no-store" })
            response.end()
          } else {
            await serveProjectMarkdown(project.root, path, request, response)
          }
        } catch (error) {
          sendSharedFileError(response, error)
        }
        return
      }
      if (url.pathname.startsWith("/v2/voice/")) {
        await serveVoiceRequest(request, response, url.pathname, voiceSettings)
        return
      }
      if (!url.pathname.startsWith("/v2/") && options.webRoot !== undefined) {
        await serveWeb(response, options.webRoot, url.pathname)
        return
      }
      if (options.providerAuth !== undefined && url.pathname.startsWith("/v2/auth/")) {
        response.setHeader("cache-control", "no-store")
        try {
          if (request.method === "GET" && url.pathname === "/v2/auth/providers") {
            sendJson(response, 200, { version: PROTOCOL_VERSION, providers: await options.providerAuth.providers() })
            return
          }
          if (request.method === "POST" && url.pathname === "/v2/auth/login") {
            assertJsonMutation(request)
            const value = await readJsonBody(request)
            if (!isAuthLoginRequest(value)) throw new HttpError(400, "Authentication request is invalid")
            sendJson(response, 202, { version: PROTOCOL_VERSION, transaction: options.providerAuth.start(value.providerId, value.type) })
            return
          }
          const transactionRoute = /^\/v2\/auth\/transactions\/([^/]+)(?:\/response)?$/.exec(url.pathname)
          if (transactionRoute !== null) {
            const id = decodeURIComponent(transactionRoute[1]!)
            if (request.method === "GET" && !url.pathname.endsWith("/response")) { sendJson(response, 200, { version: PROTOCOL_VERSION, transaction: options.providerAuth.transaction(id) }); return }
            if (request.method === "POST" && url.pathname.endsWith("/response")) {
              assertJsonMutation(request)
              const value = await readJsonBody(request)
              if (!isAuthPromptResponse(value)) throw new HttpError(400, "Authentication response is invalid")
              sendJson(response, 200, { version: PROTOCOL_VERSION, transaction: options.providerAuth.respond(id, value.value) }); return
            }
            if (request.method === "DELETE" && !url.pathname.endsWith("/response")) { sendJson(response, 200, { version: PROTOCOL_VERSION, transaction: options.providerAuth.cancel(id) }); return }
          }
          const providerRoute = /^\/v2\/auth\/providers\/([^/]+)$/.exec(url.pathname)
          if (request.method === "DELETE" && providerRoute !== null) {
            await options.providerAuth.logout(decodeURIComponent(providerRoute[1]!))
            sendJson(response, 200, { version: PROTOCOL_VERSION, providers: await options.providerAuth.providers() })
            return
          }
        } catch (error) {
          if (error instanceof ProviderAuthError) throw new HttpError(error.statusCode, error.message)
          throw error
        }
      }
      if (request.method === "GET" && url.pathname === "/v2/notifications/capabilities") {
        response.setHeader("cache-control", "no-store")
        sendJson(response, 200, await notifications.capabilities())
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/notifications/events") {
        try {
          openNativeNotificationStream(request, response, notifications, url, eventStreams)
        } catch (error) {
          if (error instanceof NotificationInputError) throw new HttpError(error.status, error.code)
          throw error
        }
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/notifications/subscription") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isNotificationSubscriptionMutation(value)) throw new HttpError(400, "Notification subscription mutation is invalid")
        try {
          if (value.action === "subscribe") {
            const result = await notificationRepository.upsert(value.deviceId, value.subscription)
            sendJson(response, result.created ? 201 : 200, { version: PROTOCOL_VERSION, enabled: true })
          } else {
            await notificationRepository.remove(value.deviceId, value.endpoint)
            sendJson(response, 200, { version: PROTOCOL_VERSION, enabled: false })
          }
        } catch (error) {
          if (error instanceof NotificationInputError) throw new HttpError(error.status, error.code)
          throw error
        }
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/notifications/presence") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        try {
          notificationPresence.report(value)
        } catch (error) {
          if (error instanceof NotificationInputError) throw new HttpError(error.status, error.code)
          throw error
        }
        sendJson(response, 200, { version: PROTOCOL_VERSION, accepted: true })
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/session-defaults") {
        sendJson(response, 200, {
          version: PROTOCOL_VERSION,
          defaults: await sessionDefaults.read(),
          models: options.sessionDefaultModels?.() ?? [],
        })
        return
      }
      if (request.method === "PUT" && url.pathname === "/v2/session-defaults") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isSessionDefaults(value)) throw new HttpError(400, "Session defaults are invalid")
        const normalized = normalizeSessionDefaults(value)
        const models = options.sessionDefaultModels?.()
        if (models !== undefined && !models.some((model) => model.provider === normalized.provider && model.modelId === normalized.modelId)) {
          throw new HttpError(400, "Session default model is not available")
        }
        sendJson(response, 200, { version: PROTOCOL_VERSION, defaults: await sessionDefaults.replace(normalized) })
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/appearance/system-theme") {
        sendJson(response, 200, await systemTheme.read())
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/appearance/system-theme/events") {
        openSystemThemeStream(request, response, systemTheme, eventStreams)
        return
      }
      if (options.updater !== undefined && request.method === "GET" && url.pathname === "/v2/update") {
        sendJson(response, 200, { version: PROTOCOL_VERSION, update: await options.updater.status() })
        return
      }
      if (options.updater !== undefined && request.method === "PUT" && url.pathname === "/v2/update/channel") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isUpdateChannelMutation(value)) throw new HttpError(400, "Update channel must be stable or edge")
        sendJson(response, 200, { version: PROTOCOL_VERSION, update: await options.updater.setChannel(value.channel) })
        return
      }
      if (options.updater !== undefined && request.method === "POST" && url.pathname === "/v2/update") {
        assertJsonMutation(request)
        await requireEmptyJsonObject(request)
        try {
          await options.updater.requestUpdate()
        } catch {
          throw new HttpError(503, "The update job could not start. Check the Pi Station service logs and try again.")
        }
        sendJson(response, 202, { version: PROTOCOL_VERSION, accepted: true })
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/settings") {
        sendJson(response, 200, { version: PROTOCOL_VERSION, settings: await settings.read() })
        return
      }
      if (request.method === "PUT" && url.pathname === "/v2/settings") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !isIanaTimezone((value as { timezone?: unknown }).timezone)) throw new HttpError(400, "Timezone must be an IANA timezone")
        sendJson(response, 200, { version: PROTOCOL_VERSION, settings: await settings.replace((value as { timezone: string }).timezone) })
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/scheduled-jobs") {
        const projectId = url.searchParams.get("projectId") ?? undefined
        if (projectId !== undefined && !isProtocolId(projectId)) throw new HttpError(400, "Project ID is invalid")
        sendJson(response, 200, { version: PROTOCOL_VERSION, jobs: await scheduledJobs.list(projectId) })
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/scheduled-jobs") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "Scheduled Job is invalid")
        const { projectId, ...input } = value as Record<string, unknown>
        if (typeof projectId !== "string" || !isProtocolId(projectId) || !isScheduledJobMutation(input)) throw new HttpError(400, "Scheduled Job is invalid")
        await findProject(projectStore, projectId)
        const job = await scheduledJobs.create(projectId, input, (await settings.read()).timezone)
        sendJson(response, 201, { version: PROTOCOL_VERSION, job })
        return
      }
      const scheduledJobRoute = /^\/v2\/scheduled-jobs\/([^/]+)(?:\/(pause|resume|run-now))?$/u.exec(url.pathname)
      if (scheduledJobRoute !== null) {
        const id = decodeURIComponent(scheduledJobRoute[1]!)
        const action = scheduledJobRoute[2]
        if (request.method === "GET" && action === undefined) {
          const job = await scheduledJobs.get(id)
          if (job === undefined) throw new HttpError(404, "Scheduled Job not found")
          sendJson(response, 200, { version: PROTOCOL_VERSION, job }); return
        }
        if (request.method === "DELETE" && action === undefined) { await scheduledJobs.delete(id); response.writeHead(204, { "access-control-allow-origin": WEB_ORIGIN, vary: "Origin" }); response.end(); return }
        if (request.method === "PUT" && action === undefined) {
          assertJsonMutation(request); const value = await readJsonBody(request)
          if (!isScheduledJobMutation(value)) throw new HttpError(400, "Scheduled Job is invalid")
          sendJson(response, 200, { version: PROTOCOL_VERSION, job: await scheduledJobs.update(id, value, (await settings.read()).timezone) }); return
        }
        if (request.method === "POST" && (action === "pause" || action === "resume")) {
          assertJsonMutation(request); const value = await readJsonBody(request); const actor = typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { actor?: unknown }).actor === "string" ? (value as { actor: string }).actor : undefined
          sendJson(response, 200, { version: PROTOCOL_VERSION, job: await scheduledJobs.setState(id, action === "pause" ? "paused" : "active", actor) }); return
        }
        if (request.method === "POST" && action === "run-now") {
          assertJsonMutation(request); await requireEmptyJsonObject(request)
          const job = await scheduledJobs.get(id); if (job === undefined) throw new HttpError(404, "Scheduled Job not found")
          sendJson(response, 202, { version: PROTOCOL_VERSION, job: await scheduler.run(job, "run-now") }); return
        }
      }
      if (request.method === "GET" && url.pathname === "/v2/workspaces") {
        const projects = await projectStore.read()
        const legacyBookmarks = (await projectBookmarks.list(projects)).map(({ projectId }) => projectId)
        sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.list(projects, legacyBookmarks, await sessions()) })
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/workspaces") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isWorkspaceCreateMutation(value)) throw new HttpError(400, "Workspace is invalid")
        const projects = await projectStore.read()
        const created = await workspaceStore.create(value, projects, [], await sessions())
        // create appends this request's Workspace to its atomic result, not a later global snapshot.
        sendJson(response, 201, { version: PROTOCOL_VERSION, ...created, createdWorkspaceId: created.workspaces.at(-1)!.id })
        return
      }
      const workspaceActivationRoute = /^\/v2\/workspaces\/([^/]+)\/activate$/u.exec(url.pathname)
      if (request.method === "POST" && workspaceActivationRoute !== null) {
        assertJsonMutation(request)
        await requireEmptyJsonObject(request)
        const workspaceId = decodeURIComponent(workspaceActivationRoute[1]!)
        if (!isProtocolId(workspaceId)) throw new HttpError(404, "Not found")
        sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.select(workspaceId, await projectStore.read(), await sessions()) })
        return
      }
      const workspaceTabRoute = /^\/v2\/workspaces\/([^/]+)\/tabs(?:\/([^/]+)(?:\/(activate))?)?$/u.exec(url.pathname)
      if (workspaceTabRoute !== null) {
        const workspaceId = decodeURIComponent(workspaceTabRoute[1]!)
        const tabId = workspaceTabRoute[2] === undefined ? undefined : decodeURIComponent(workspaceTabRoute[2])
        if (!isProtocolId(workspaceId) || (tabId !== undefined && !isProtocolId(tabId))) throw new HttpError(404, "Not found")
        const projects = await projectStore.read()
        const listed = await sessions()
        if (request.method === "POST" && tabId === undefined) {
          assertJsonMutation(request); const value = await readJsonBody(request)
          if (!isWorkspaceOpenSessionMutation(value)) throw new HttpError(400, "Workspace Session tab is invalid")
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.openSession(workspaceId, value.projectId, value.sessionId, projects, listed) }); return
        }
        if (request.method === "PUT" && tabId === undefined) {
          assertJsonMutation(request); const value = await readJsonBody(request)
          if (!isWorkspaceReorderTabsMutation(value)) throw new HttpError(400, "Workspace tab order is invalid")
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.reorderTabs(workspaceId, value.tabIds, projects, listed) }); return
        }
        if (request.method === "DELETE" && tabId !== undefined && workspaceTabRoute[3] === undefined) {
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.closeTab(workspaceId, tabId, projects, listed) }); return
        }
        if (request.method === "POST" && tabId !== undefined && workspaceTabRoute[3] === "activate") {
          assertJsonMutation(request); await requireEmptyJsonObject(request)
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.selectTab(workspaceId, tabId, projects, listed) }); return
        }
      }
      const workspaceLifecycleRoute = /^\/v2\/workspaces\/([^/]+)\/(close|restore)$/u.exec(url.pathname)
      if (request.method === "POST" && workspaceLifecycleRoute !== null) {
        assertJsonMutation(request); await requireEmptyJsonObject(request)
        const workspaceId = decodeURIComponent(workspaceLifecycleRoute[1]!)
        if (!isProtocolId(workspaceId)) throw new HttpError(404, "Not found")
        sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.setWorkspaceClosed(workspaceId, workspaceLifecycleRoute[2] === "close", await projectStore.read(), await sessions()) })
        return
      }
      const workspaceProjectRoute = /^\/v2\/workspaces\/([^/]+)\/projects\/([^/]+)(?:\/(open))?$/u.exec(url.pathname)
      if (workspaceProjectRoute !== null && ((request.method === "POST" && workspaceProjectRoute[3] === "open") || (request.method === "DELETE" && workspaceProjectRoute[3] === undefined))) {
        const workspaceId = decodeURIComponent(workspaceProjectRoute[1]!)
        const projectId = decodeURIComponent(workspaceProjectRoute[2]!)
        if (!isProtocolId(workspaceId) || !isProtocolId(projectId)) throw new HttpError(404, "Not found")
        const projects = await projectStore.read()
        if (request.method === "POST") {
          assertJsonMutation(request)
          await requireEmptyJsonObject(request)
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.openProject(workspaceId, projectId, projects) })
        } else {
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.removeWorkspaceProject(workspaceId, projectId, projects) })
        }
        return
      }
      const workspaceRoute = /^\/v2\/workspaces\/([^/]+)$/u.exec(url.pathname)
      if (workspaceRoute !== null && (request.method === "PUT" || request.method === "DELETE")) {
        const workspaceId = decodeURIComponent(workspaceRoute[1]!)
        if (!isProtocolId(workspaceId)) throw new HttpError(404, "Not found")
        if (request.method === "PUT") {
          assertJsonMutation(request)
          const value = await readJsonBody(request)
          if (!isWorkspaceUpdateMutation(value)) throw new HttpError(400, "Workspace is invalid")
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.update(workspaceId, value, await projectStore.read()) })
        } else {
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...await workspaceStore.remove(workspaceId, await projectStore.read()) })
        }
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/projects") {
        const projects = await projectStore.read()
        sendJson(response, 200, { version: PROTOCOL_VERSION, projects, bookmarks: await projectBookmarks.list(projects) })
        return
      }
      if (request.method === "PUT" && url.pathname === "/v2/project-bookmarks") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isProjectBookmarkMutation(value)) throw new HttpError(400, "Project Bookmark mutation is invalid")
        const projects = await projectStore.read()
        const bookmarks = value.action === "set"
          ? await projectBookmarks.set(value.projectId, value.bookmarked, projects)
          : await projectBookmarks.reorder(value.projectId, value.direction, projects)
        sendJson(response, 200, { version: PROTOCOL_VERSION, bookmarks })
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/projects") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isProjectCreate(value)) throw new HttpError(400, "Project is invalid")
        const projects = await projectStore.add(value.root, value.name ?? basename(value.root))
        sendJson(response, 201, { version: PROTOCOL_VERSION, projects })
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/session-hosts") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isSessionHostRequest(value)) throw new HttpError(400, "Session directory is invalid")
        const root = await realpath(value.root)
        sendJson(response, 200, { version: PROTOCOL_VERSION, project: { id: stableProjectId(root), root } })
        return
      }
      if (request.method === "PUT" && url.pathname === "/v2/projects") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isProjectRootsRequest(value)) throw new HttpError(400, "Project roots are invalid")
        const projects = await projectStore.configure(value.roots)
        sendJson(response, 200, { version: PROTOCOL_VERSION, projects })
        return
      }
      const projectStateRoute = /^\/v2\/projects\/([^/]+)\/(close|open)$/u.exec(url.pathname)
      if (request.method === "POST" && projectStateRoute !== null) {
        assertJsonMutation(request)
        await requireEmptyJsonObject(request)
        const projectId = decodeURIComponent(projectStateRoute[1]!)
        if (!isProtocolId(projectId)) throw new HttpError(404, "Not found")
        await projectStore.setClosed(projectId, projectStateRoute[2] === "close")
        const projects = await projectStore.read()
        sendJson(response, 200, { version: PROTOCOL_VERSION, projects, bookmarks: await projectBookmarks.list(projects) })
        return
      }
      const projectRoute = /^\/v2\/projects\/([^/]+)$/u.exec(url.pathname)
      if (request.method === "PUT" && projectRoute !== null) {
        assertJsonMutation(request)
        const projectId = decodeURIComponent(projectRoute[1]!)
        if (!isProtocolId(projectId)) throw new HttpError(404, "Not found")
        const value = await readJsonBody(request)
        if (!isProjectRename(value)) throw new HttpError(400, "Project name is invalid")
        sendJson(response, 200, { version: PROTOCOL_VERSION, projects: await projectStore.rename(projectId, value.name) })
        return
      }
      if (request.method === "DELETE" && projectRoute !== null) {
        const projectId = decodeURIComponent(projectRoute[1]!)
        if (!isProtocolId(projectId)) throw new HttpError(404, "Not found")
        const project = await findProject(projectStore, projectId)
        // Keep the canonical root in memory so an active turn can index its final
        // timeline after the Project disappears from configured navigation.
        disassociatedProjects.set(projectId, project)
        await Promise.all([
          projectBookmarks.removeProject(projectId),
          sessionBookmarks.removeProject(projectId),
          metadata.removeProject(projectId),
          scheduledJobs.disableProject(projectId),
          workspaceStore.removeProject(projectId, await projectStore.read()),
        ])
        // Delegation records are intentionally retained. A working child still
        // needs its routing context to finish and report to its parent safely.
        const projects = await projectStore.remove(projectId)
        sendJson(response, 200, {
          version: PROTOCOL_VERSION,
          projects,
          bookmarks: await projectBookmarks.list(projects),
        })
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/directories") {
        sendJson(response, 200, await listDirectories(url.searchParams.get("path"), url.searchParams.get("hidden") === "true"))
        return
      }
      if (url.pathname === "/v2/quick-session" && request.method === "GET") {
        const record = await quickSessions.read()
        const session = record === undefined ? undefined : await findSession({ projectId: QUICK_SESSION_PROJECT_ID, sessionId: record.sessionId })
        const action = record === undefined ? undefined : quickActions.get(record.sessionId)
        sendJson(response, 200, { version: PROTOCOL_VERSION, ...(session === undefined ? {} : { session }), ...(action === undefined ? {} : { action }) })
        return
      }
      if (url.pathname === "/v2/quick-session" && request.method === "POST") {
        assertJsonMutation(request)
        await requireEmptyJsonObject(request)
        const record = await quickSessions.open()
        const session = await findSession({ projectId: QUICK_SESSION_PROJECT_ID, sessionId: record.sessionId })
        if (session === undefined) throw new Error("Quick Session was not indexed")
        sendJson(response, 200, { version: PROTOCOL_VERSION, session })
        return
      }
      if (url.pathname === "/v2/quick-session/cancel" && request.method === "POST") {
        assertJsonMutation(request); await requireEmptyJsonObject(request)
        const record = await quickSessions.read(); if (record === undefined) throw new HttpError(404, "Quick Session not found")
        const cancelled = quickActions.get(record.sessionId)?.status === "pending"
        if (cancelled) quickActions.delete(record.sessionId)
        sendJson(response, 200, { version: PROTOCOL_VERSION, cancelled })
        return
      }
      if (url.pathname === "/v2/quick-session/clear" && request.method === "POST") {
        assertJsonMutation(request); await requireEmptyJsonObject(request)
        const record = await quickSessions.read(); if (record === undefined) throw new HttpError(404, "Quick Session not found")
        const key = { projectId: QUICK_SESSION_PROJECT_ID, sessionId: record.sessionId }
        const token = randomUUID(); const pending: QuickAction = { token, type: "clear", status: "pending" }
        const apply = async (): Promise<void> => {
          while (turns.isWorking(key) && quickActions.get(record.sessionId)?.token === token) await new Promise((done) => setTimeout(done, 50))
          if (quickActions.get(record.sessionId)?.token !== token) return
          try { await quickSessions.clear(record.sessionId); quickActions.delete(record.sessionId) }
          catch (error) { quickActions.set(record.sessionId, { token, type: "clear", status: "failed", error: error instanceof Error ? error.message : "Clear failed" }) }
        }
        if (turns.isWorking(key)) { quickActions.set(record.sessionId, pending); void apply(); sendJson(response, 202, { version: PROTOCOL_VERSION, action: pending }); return }
        quickActions.set(record.sessionId, pending); await apply()
        const action = quickActions.get(record.sessionId); if (action?.status === "failed") throw new HttpError(422, action.error)
        const fresh = await quickSessions.read(); sendJson(response, 200, { version: PROTOCOL_VERSION, session: fresh === undefined ? undefined : await findSession({ projectId: QUICK_SESSION_PROJECT_ID, sessionId: fresh.sessionId }) })
        return
      }
      if (url.pathname === "/v2/quick-session/keep" && request.method === "POST") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as { destination?: unknown }).destination !== "string" || (value as { destination: string }).destination.trim() === "") throw new HttpError(400, "Destination is invalid")
        const destination = (value as { destination: string }).destination
        const record = await quickSessions.read(); if (record === undefined) throw new HttpError(404, "Quick Session not found")
        const key = { projectId: QUICK_SESSION_PROJECT_ID, sessionId: record.sessionId }
        const token = randomUUID(); const pending: QuickAction = { token, type: "keep", status: "pending" }
        const apply = async (): Promise<void> => {
          while (turns.isWorking(key) && quickActions.get(record.sessionId)?.token === token) await new Promise((done) => setTimeout(done, 50))
          if (quickActions.get(record.sessionId)?.token !== token) return
          try {
            const kept = await quickSessions.keep(record.sessionId, destination); const target = resolve(destination)
            const matched = (await projectStore.read()).filter(({ root }) => { const path = relative(resolve(root), target); return path === "" || (!path.startsWith("..") && !path.startsWith(sep)) }).sort((left, right) => resolve(right.root).length - resolve(left.root).length)[0]
            const project = matched ?? kept.project; const sessionFile = await stat(kept.sessionPath)
            await options.index.indexSession({ id: record.sessionId, projectId: project.id, path: kept.sessionPath, cwd: target, modifiedAt: sessionFile.mtime.toISOString() }); quickActions.delete(record.sessionId)
          } catch (error) { quickActions.set(record.sessionId, { token, type: "keep", status: "failed", error: error instanceof Error ? error.message : "Keep failed" }) }
        }
        if (turns.isWorking(key)) { quickActions.set(record.sessionId, pending); void apply(); sendJson(response, 202, { version: PROTOCOL_VERSION, action: pending }); return }
        quickActions.set(record.sessionId, pending); await apply()
        const action = quickActions.get(record.sessionId); if (action?.status === "failed") throw new HttpError(422, action.error)
        sendJson(response, 200, { version: PROTOCOL_VERSION, sessionId: record.sessionId }); return
      }
      if (request.method === "GET" && url.pathname === "/v2/sessions") {
        const listed = await sessions()
        sendJson(response, 200, {
          version: PROTOCOL_VERSION,
          sequence: sessionUpdates.sequence,
          sessions: listed,
          phases: listed.map((session) => ({ ...turns.phase({ projectId: session.projectId, sessionId: session.id }), projectId: session.projectId, sessionId: session.id })),
          bookmarks: await sessionBookmarks.list(listed),
        })
        return
      }
      if (request.method === "PUT" && url.pathname === "/v2/session-bookmarks") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isSessionBookmarkMutation(value)) throw new HttpError(400, "Session Bookmark mutation is invalid")
        const listed = await sessions()
        const bookmarks = value.action === "set"
          ? await sessionBookmarks.set(value.projectId, value.sessionId, value.bookmarked, listed)
          : await sessionBookmarks.reorder(value.projectId, value.sessionId, value.direction, listed)
        sendJson(response, 200, { version: PROTOCOL_VERSION, bookmarks })
        return
      }
      if (request.method === "GET" && url.pathname === "/v2/sessions/events") {
        openSessionUpdates(request, response, sessionUpdates, url, eventStreams)
        return
      }
      if (request.method === "POST" && url.pathname === "/v2/images") {
        const mediaType = imageMediaType(request)
        const data = await readImageBody(request, mediaType)
        sendJson(response, 201, { version: PROTOCOL_VERSION, id: imageUploads.add(url.searchParams.get("name") ?? "", mediaType, data), mediaType, size: data.length })
        return
      }
      const imageRoute = /^\/v2\/images\/([A-Za-z0-9_-]{1,64})$/u.exec(url.pathname)
      if (request.method === "GET" && imageRoute !== null) {
        const image = imageUploads.resolve([imageRoute[1]!])?.[0]
        if (image === undefined) throw new HttpError(404, "Image is not available")
        response.writeHead(200, { "content-type": image.mediaType, "content-length": image.data.length, "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": WEB_ORIGIN, vary: "Origin" })
        response.end(image.data); return
      }
      if (request.method === "DELETE" && imageRoute !== null) {
        imageUploads.delete(imageRoute[1]!)
        response.writeHead(204, { "access-control-allow-origin": WEB_ORIGIN, vary: "Origin" })
        response.end()
        return
      }

      const stashRoute = /^\/v2\/projects\/([^/]+)\/sessions\/([^/]+)\/message-stashes(?:\/([A-Za-z0-9-]{1,64})\/consume)?$/u.exec(url.pathname)
      if (stashRoute !== null) {
        const key = { projectId: decodeURIComponent(stashRoute[1]!), sessionId: decodeURIComponent(stashRoute[2]!) }
        const savedSession = await findSession(key)
        if (savedSession === undefined) throw new HttpError(404, "Session not found")
        await resolveProject(key, savedSession)
        if (request.method === "GET" && stashRoute[3] === undefined) { sendJson(response, 200, { version: PROTOCOL_VERSION, stashes: await messageStashes.list(key) }); return }
        if (request.method === "POST" && stashRoute[3] === undefined) {
          if (savedSession.state === "closed") throw new HttpError(409, "Closed Session is read-only")
          assertJsonMutation(request); const value = await readJsonBody(request)
          if (!isCreateMessageStashRequest(value)) throw new HttpError(400, "Stashed message is invalid")
          sendJson(response, 201, { version: PROTOCOL_VERSION, stash: await messageStashes.create(key, value) }); return
        }
        if (request.method === "POST" && stashRoute[3] !== undefined) {
          if (savedSession.state === "closed") throw new HttpError(409, "Closed Session is read-only")
          assertJsonMutation(request); await readJsonBody(request)
          sendJson(response, 200, { version: PROTOCOL_VERSION, ...(await messageStashes.consume(key, stashRoute[3])) }); return
        }
      }

      const attachmentRoute = parseSessionAttachmentRoute(url.pathname)
      if (attachmentRoute !== undefined) {
        const savedAttachmentSession = await findSession(attachmentRoute.key)
        if (savedAttachmentSession === undefined && !isGeneratedSessionId(attachmentRoute.key.sessionId)) throw new HttpError(404, "Session not found")
        await resolveProject(attachmentRoute.key, savedAttachmentSession)
        if (attachmentRoute.attachmentId === undefined && request.method === "POST") {
          if (savedAttachmentSession?.state === "closed") throw new HttpError(409, "Closed Session is read-only")
          const value = await attachments.upload(attachmentRoute.key, request, url.searchParams.get("name") ?? undefined)
          sendJson(response, 201, { version: PROTOCOL_VERSION, attachment: value }); return
        }
        if (attachmentRoute.attachmentId !== undefined && request.method === "DELETE") {
          if (savedAttachmentSession?.state === "closed") throw new HttpError(409, "Closed Session is read-only")
          if (!await attachments.delete(attachmentRoute.key, attachmentRoute.attachmentId)) throw new HttpError(404, "Attachment is not available")
          response.writeHead(204, { "access-control-allow-origin": WEB_ORIGIN, vary: "Origin" }); response.end(); return
        }
        if (attachmentRoute.attachmentId !== undefined && request.method === "GET") {
          const value = await attachments.get(attachmentRoute.key, attachmentRoute.attachmentId)
          if (value === undefined) throw new HttpError(404, "Attachment is not available")
          response.writeHead(200, { "content-type": value.mediaType, "content-length": value.size, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(value.name)}`, "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'", "x-content-type-options": "nosniff", "access-control-allow-origin": WEB_ORIGIN, vary: "Origin" })
          attachments.stream(value).pipe(response); return
        }
      }

      const historyImageRoute = parseSessionImageRoute(url.pathname)
      if (request.method === "GET" && historyImageRoute !== undefined) {
        const saved = await findSession(historyImageRoute.key)
        if (saved === undefined) throw new HttpError(404, "Image is not available")
        const image = await options.index.timelineImage(saved, historyImageRoute.imageId)
        if (image === undefined) throw new HttpError(404, "Image is not available")
        sendHistoryImage(response, image)
        return
      }

      const sessionCollection = /^\/v2\/projects\/([^/]+)\/sessions$/u.exec(url.pathname)
      if (request.method === "POST" && sessionCollection !== null) {
        assertJsonMutation(request)
        const projectId = decodeURIComponent(sessionCollection[1] ?? "")
        const value = await readJsonBody(request)
        if (!isSessionCreateRequest(value)) throw new HttpError(400, "Session request is invalid")
        const project = await resolveNewSessionProject(projectStore, { projectId, sessionId: "new" }, value.cwd)
        await ensureProjectOpen(project.id)
        const sessionId = randomUUID()
        initializeSession(project.root, sessionId, value.name)
        const indexed = await options.index.refreshSession({ projectId, sessionId }, project)
        if (indexed === undefined) throw new Error("Created Session was not indexed")
        await metadata.set({ projectId, sessionId }, "open")
        sendJson(response, 201, { version: PROTOCOL_VERSION, session: await publishSession({ ...indexed, state: "open" }) })
        return
      }

      const route = parseSessionRoute(url.pathname)
      if (route === undefined) throw new HttpError(404, "Not found")
      const saved = await findSession(route.key)

      if (request.method === "POST" && route.action === "turn") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isNewTurnRequest(value)) throw new HttpError(400, "Turn request is invalid")

        const isNew = saved === undefined
        if (saved?.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        if (isNew && !isGeneratedSessionId(route.key.sessionId)) {
          throw new HttpError(404, "Session not found")
        }
        const project = isNew
          ? await resolveNewSessionProject(projectStore, route.key, (value as typeof value & { readonly cwd?: string }).cwd)
          : await resolveProject(route.key, saved)
        await ensureProjectOpen(project.id)
        if (isNew) await metadata.set(route.key, "open")

        const imageIds = value.imageIds ?? []
        const images = imageIds.length === 0 ? [] : imageUploads.resolve(imageIds)
        if (images === undefined) throw new HttpError(400, "An attached image is missing or expired")
        const promptImages = images.map((image) => ({ mediaType: image.mediaType, data: image.data.toString("base64") }))
        const promptAttachments = await attachments.resolve(route.key, (value as typeof value & { attachmentIds?: readonly string[] }).attachmentIds ?? [])
        if (promptAttachments === undefined) throw new HttpError(400, "An attached file is missing")
        const persistedImages = await Promise.all(images.map((image) => attachments.save(route.key, image.data, image.name, image.mediaType)))
        const allAttachments = [...promptAttachments, ...persistedImages]
        const accepted = turns.start({
          ...route.key,
          cwd: project.root,
          prompt: attachmentPrompt(value.prompt, allAttachments),
          ...(promptImages.length === 0 ? {} : { images: promptImages }),
          ...(allAttachments.length === 0 ? {} : { attachmentMarker: attachmentMarker(allAttachments) }),
          ...(value.agentMentions === undefined ? {} : { agentMentions: value.agentMentions }),
          mode: isNew ? "new" : "existing",
          ...(saved === undefined ? {} : { sessionPath: saved.path }),
          ...(value.name === undefined ? {} : { name: value.name }),
          settledTimeline: settledTimeline(route.key, project),
        })
        if (!accepted) throw new HttpError(409, "Session is working")
        for (const id of imageIds) imageUploads.delete(id)
        sendJson(response, 202, { version: PROTOCOL_VERSION, accepted: true })
        return
      }

      if (request.method === "POST" && (route.action === "steer" || route.action === "follow-up")) {
        assertJsonMutation(request)
        if (saved?.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        const value = await readJsonBody(request)
        if (!isPrompt(value)) throw new HttpError(400, "Prompt is invalid")
        const imageIds = value.imageIds ?? []
        const images = imageIds.length === 0 ? [] : imageUploads.resolve(imageIds)
        if (images === undefined) throw new HttpError(400, "An attached image is missing or expired")
        const promptImages = images.map((image) => ({ mediaType: image.mediaType, data: image.data.toString("base64") }))
        const promptAttachments = await attachments.resolve(route.key, (value as typeof value & { attachmentIds?: readonly string[] }).attachmentIds ?? [])
        if (promptAttachments === undefined) throw new HttpError(400, "An attached file is missing")
        const persistedImages = await Promise.all(images.map((image) => attachments.save(route.key, image.data, image.name, image.mediaType)))
        const allAttachments = [...promptAttachments, ...persistedImages]
        const injectedPrompt = attachmentPrompt(value.prompt, allAttachments)
        const marker = allAttachments.length === 0 ? undefined : attachmentMarker(allAttachments)
        let accepted = route.action === "steer"
          ? await turns.steer(route.key, injectedPrompt, promptImages.length === 0 ? undefined : promptImages, marker, value.agentMentions)
          : await turns.followUp(route.key, injectedPrompt, promptImages.length === 0 ? undefined : promptImages, marker, value.agentMentions)
        if (!accepted && saved !== undefined) {
          const project = await resolveProject(route.key, saved)
          accepted = await options.runner.deliver?.({
            sessionId: route.key.sessionId,
            cwd: project.root,
            delivery: route.action === "steer" ? "steer" : "followUp",
            message: injectedPrompt,
            ...(promptImages.length === 0 ? {} : { images: promptImages }),
            ...(marker === undefined ? {} : { attachmentMarker: marker }),
            ...(value.agentMentions === undefined ? {} : { agentMentions: value.agentMentions }),
          }) ?? false
        }
        if (!accepted) throw new HttpError(409, "Session is not accepting active-turn input")
        for (const id of imageIds) imageUploads.delete(id)
        sendJson(response, 202, { version: PROTOCOL_VERSION, accepted: true })
        return
      }

      if (request.method === "DELETE" && route.action === "queue") {
        assertJsonMutation(request)
        if (!await turns.clearQueue(route.key)) throw new HttpError(409, "Session has no active message queue")
        sendJson(response, 200, { version: PROTOCOL_VERSION, cleared: true })
        return
      }

      if (request.method === "POST" && route.action === "approval") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (typeof value !== "object" || value === null || Object.keys(value).length !== 2
          || typeof (value as { id?: unknown }).id !== "string" || typeof (value as { allowed?: unknown }).allowed !== "boolean") {
          throw new HttpError(400, "Invalid command approval response")
        }
        if (options.commandApprovals?.resolve(route.key, (value as { id: string }).id, (value as { allowed: boolean }).allowed) !== true) {
          throw new HttpError(404, "Command approval not found")
        }
        sendJson(response, 200, { version: PROTOCOL_VERSION })
        return
      }

      if (request.method === "POST" && route.action === "abort") {
        assertJsonMutation(request)
        if (saved?.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        await requireEmptyJsonObject(request)
        let aborted = await turns.abort(route.key)
        if (!aborted && saved !== undefined) {
          const project = await resolveProject(route.key, saved)
          aborted = await options.runner.abortSession?.({ sessionId: route.key.sessionId, cwd: project.root }) ?? false
        }
        if (!aborted) throw new HttpError(409, "Session is not working")
        sendJson(response, 202, { version: PROTOCOL_VERSION, accepted: true })
        return
      }

      if (request.method === "POST" && route.action === "undo") {
        assertJsonMutation(request)
        if (saved === undefined) throw new HttpError(404, "Session not found")
        if (saved.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        if (turns.isWorking(route.key)) throw new HttpError(409, "Working Session cannot undo a message")
        const value = await readJsonBody(request)
        if (!isUndoRequest(value)) throw new HttpError(400, "Undo request is invalid")
        const project = await resolveProject(route.key, saved)
        try {
          // The Session file can change through another Pi process. Reload it before
          // branching so the SDK runtime validates against the latest active leaf.
          await turns.control(route.key, saved.path, project.root, { type: "reload" })
          await turns.control(route.key, saved.path, project.root, { type: "undo_user_message", entryId: value.entryId })
        } catch (error) {
          throw new HttpError(422, error instanceof Error ? error.message : "Pi rejected the message undo")
        }
        sendJson(response, 200, { version: PROTOCOL_VERSION, undone: true })
        return
      }

      if (request.method === "POST" && route.action === "clone") {
        assertJsonMutation(request)
        if (saved === undefined) throw new HttpError(404, "Session not found")
        if (saved.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        if (turns.isWorking(route.key)) throw new HttpError(409, "Working Session cannot be cloned")
        const value = await readJsonBody(request)
        if (!isOptionalSessionNameRequest(value)) throw new HttpError(400, "Clone request is invalid")
        const project = await resolveProject(route.key, saved)
        const cloneId = randomUUID()
        const manager = SessionManager.forkFrom(saved.path, project.root, undefined, { id: cloneId })
        if (value.name !== undefined) manager.appendSessionInfo(value.name)
        const cloneKey = { projectId: saved.projectId, sessionId: cloneId }
        const indexed = await options.index.refreshSession(cloneKey, project)
        if (indexed === undefined) throw new Error("Cloned Session was not indexed")
        const clone = { ...indexed, state: "open" as const }
        const decoratedClone = await publishSession(clone)
        sendJson(response, 201, { version: PROTOCOL_VERSION, session: decoratedClone })
        return
      }

      if (route.action === "move" && request.method === "POST") {
        assertJsonMutation(request)
        if (saved === undefined) throw new HttpError(404, "Session not found")
        const value = await readJsonBody(request)
        if (!isSessionMoveRequest(value)) throw new HttpError(400, "Session move request is invalid")
        try { sendJson(response, 202, { version: PROTOCOL_VERSION, ...(await requestSessionMove(saved.id, value.projectId)) }) }
        catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Session move failed") }
        return
      }

      if (route.action === "move" && request.method === "DELETE") {
        if (saved === undefined) throw new HttpError(404, "Session not found")
        const cancelled = pendingSessionMoves.delete(saved.id)
        if (cancelled) await publishSession(saved)
        sendJson(response, 200, { version: PROTOCOL_VERSION, cancelled })
        return
      }

      if (request.method === "POST" && route.action === "reload") {
        assertJsonMutation(request)
        if (saved === undefined) throw new HttpError(404, "Session not found")
        if (saved.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        if (turns.isWorking(route.key)) throw new HttpError(409, "Working Session cannot be reloaded")
        await requireEmptyJsonObject(request)
        const project = await resolveProject(route.key, saved)
        try {
          await turns.control(route.key, saved.path, project.root, { type: "reload" })
        } catch (error) {
          throw new HttpError(422, error instanceof Error ? error.message : "Pi rejected the Session reload")
        }
        sendJson(response, 200, { version: PROTOCOL_VERSION, reloaded: true })
        return
      }

      if (request.method === "GET" && route.action === "events") {
        if (saved === undefined && !turns.isWorking(route.key)) {
          throw new HttpError(404, "Session not found")
        }
        const watch = saved === undefined ? undefined : () => sessionFiles.subscribe(saved.path, async () => {
          try {
            const project = await resolveProject(route.key, saved)
            const indexed = await options.index.refreshSession(route.key, project)
            if (indexed === undefined) return
            const refreshed = (await decorateSessions(await metadata.decorate([indexed])))[0]
            if (refreshed !== undefined) await publishSession(refreshed)
            journal.publish(route.key, { version: 2, type: "timeline", timeline: await options.index.timeline(indexed) })
          } catch {
            // A later bounded poll retries transient reads while terminal Pi writes JSONL.
          }
        })
        openEventStream(request, response, route.key, journal, turns.phase(route.key), eventStreams, watch)
        return
      }

      if (saved === undefined) throw new HttpError(404, "Session not found")
      if (request.method === "PUT" && (route.action === "model" || route.action === "thinking")) {
        assertJsonMutation(request)
        if (saved.state === "closed") throw new HttpError(409, "Closed Session is read-only")
        const project = await resolveProject(route.key, saved)
        const value = await readJsonBody(request)
        try {
          if (route.action === "model") {
            if (!isModelSettingRequest(value)) throw new HttpError(400, "Model setting is invalid")
            await turns.control(route.key, saved.path, project.root, { type: "set_model", ...value })
          } else {
            if (!isThinkingSettingRequest(value)) throw new HttpError(400, "Thinking setting is invalid")
            await turns.control(route.key, saved.path, project.root, { type: "set_thinking_level", level: value.level })
          }
        } catch (error) {
          if (error instanceof HttpError) throw error
          throw new HttpError(422, error instanceof Error ? error.message : "Pi rejected the Session setting")
        }
        const settings = await readSessionSettings(turns, route.key, saved.path, project.root)
        const refreshed = await options.index.refreshSession(route.key, project)
        if (refreshed !== undefined) await publishSession({ ...refreshed, state: saved.state })
        sendJson(response, 200, { version: PROTOCOL_VERSION, settings })
        return
      }
      if (request.method === "GET" && route.action === "shared-files") {
        sendJson(response, 200, {
          version: PROTOCOL_VERSION,
          sharedFiles: await options.sharedFiles?.list(route.key.sessionId) ?? [],
        })
        return
      }
      if (request.method === "PUT" && route.action === "name") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isSessionNameRequest(value)) throw new HttpError(400, "Session name is invalid")
        if (turns.isWorking(route.key)) throw new HttpError(409, "Working Session cannot be renamed")
        const changed = { ...await options.index.rename(saved, value.name), state: saved.state }
        const decoratedChanged = await publishSession(changed)
        sendJson(response, 200, { version: PROTOCOL_VERSION, session: decoratedChanged })
        return
      }
      if (request.method === "PUT" && route.action === "state") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isSessionStateRequest(value)) throw new HttpError(400, "Session state is invalid")
        if (value.state === "closed" && turns.isWorking(route.key)) throw new HttpError(409, "Working Session cannot be closed")
        if (value.state === "open") await ensureProjectOpen(route.key.projectId)
        await metadata.set(route.key, value.state)
        const changed = { ...saved, state: value.state }
        await publishSession(changed)
        sendJson(response, 200, { version: PROTOCOL_VERSION, state: value.state })
        return
      }
      if (request.method === "POST" && route.action === "read") {
        assertJsonMutation(request)
        const value = await readJsonBody(request)
        if (!isMarkReadRequest(value)) throw new HttpError(400, "Read marker is invalid")
        const unread = await attentionStore.markRead(route.key, value.attentionId)
        if (unread === undefined) throw new HttpError(409, "Read marker is stale")
        await publishSession(saved)
        sendJson(response, 200, { version: PROTOCOL_VERSION, unread })
        return
      }
      if (request.method === "GET" && route.action === "history") {
        if (saved === undefined) throw new HttpError(404, "Session not found")
        const before = url.searchParams.get("before") ?? undefined
        if (before !== undefined && (before.length === 0 || before.length > 1024)) throw new HttpError(400, "History cursor is invalid")
        try {
          sendJson(response, 200, await options.index.historyPage(saved, before))
        } catch (error) {
          if (error instanceof StaleHistoryCursorError) throw new HttpError(409, error.message)
          throw error
        }
        return
      }
      if (request.method === "GET" && route.action === undefined) {
        const eventCursor = journal.cursor()
        const project = await resolveProject(route.key, saved)
        const indexed = await options.index.refreshSession(route.key, project) ?? saved
        const refreshed = (await decorateSessions(await metadata.decorate([indexed])))[0]
        if (refreshed === undefined) throw new HttpError(404, "Session not found")
        const history = await options.index.historyPage(indexed)
        sendJson(response, 200, {
          version: PROTOCOL_VERSION,
          eventCursor,
          session: refreshed,
          phase: turns.phase(route.key).phase,
          phaseEpoch: turns.phase(route.key).epoch,
          phaseGeneration: turns.phase(route.key).generation,
          timeline: history.timeline,
          historyRevision: history.revision,
          ...(history.before === undefined ? {} : { historyBefore: history.before }),
          hasEarlierHistory: history.hasEarlier,
          settings: await readSessionSettings(turns, route.key, indexed.path, project.root),
          commandInventory: await readCommandInventory(turns, route.key, indexed.path, project.root),
          sharedFiles: await options.sharedFiles?.list(route.key.sessionId) ?? [],
          ...(() => {
            const approval = options.commandApprovals?.current(route.key)
            return approval === undefined ? {} : {
              commandApproval: approval.kind === "command"
                ? { id: approval.id, kind: "command", command: approval.command }
                : { id: approval.id, kind: "delegation", model: approval.model, thinkingLevel: approval.thinkingLevel },
            }
          })(),
        })
        return
      }
      throw new HttpError(404, "Not found")
    } catch (error) {
      if (error instanceof ScheduledJobError) sendError(response, new HttpError(error.code === "not-found" ? 404 : error.code === "limit" ? 409 : 400, error.message))
      else if (error instanceof WorkspaceStoreError) sendError(response, new HttpError(error.code === "not-found" ? 404 : error.code === "limit" ? 409 : 400, error.message))
      else sendError(response, error)
    }
  })
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    scheduler.stop()
    unsubscribeDelegatedTurns?.()
    unsubscribeDelegations?.()
    unsubscribeCommandApprovals?.()
    options.commandApprovals?.close()
    sessionFiles.dispose()
    systemTheme.dispose()
    turns.dispose()
    options.runner.dispose()
  }
  shutdownContexts.set(server, { shutdown: async (timeoutMs) => {
    acceptingWork = false
    shutdownStarted = true
    for (const stream of eventStreams) stream.end()
    eventStreams.clear()
    const closed = new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    if (!await turns.drain(timeoutMs)) {
      turns.interruptOwned()
      await turns.drain(Math.min(500, timeoutMs))
    }
    dispose()
    // Bound shutdown even when a non-SSE HTTP peer does not close its socket.
    server.closeAllConnections()
    await closed
  } })
  server.once("close", () => { if (!shutdownStarted) dispose() })
  return server
}

type NotificationSubscriptionMutation =
  | { readonly action: "subscribe"; readonly deviceId: string; readonly subscription: unknown }
  | { readonly action: "unsubscribe"; readonly deviceId: string; readonly endpoint: unknown }

function isNotificationSubscriptionMutation(value: unknown): value is NotificationSubscriptionMutation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.deviceId !== "string") return false
  if (record.action === "subscribe") return Object.keys(record).length === 3 && "subscription" in record
  return record.action === "unsubscribe" && Object.keys(record).length === 3 && "endpoint" in record
}

function isMarkReadRequest(value: unknown): value is { readonly attentionId: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1
    && typeof (value as Record<string, unknown>).attentionId === "string"
    && ((value as Record<string, unknown>).attentionId as string).length > 0
    && ((value as Record<string, unknown>).attentionId as string).length <= 500
}

function isOptionalSessionNameRequest(value: unknown): value is { readonly name?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 0 || isSessionNameRequest(value)
}

function isSessionCreateRequest(value: unknown): value is { readonly cwd?: string; readonly name?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.every((key) => key === "cwd" || key === "name")
    && (record.cwd === undefined || typeof record.cwd === "string")
    && (record.name === undefined || (typeof record.name === "string" && record.name.trim().length > 0 && record.name.length <= 120))
}

function isSessionNameRequest(value: unknown): value is { readonly name: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 1 && typeof record.name === "string"
    && record.name.trim().length > 0 && record.name.length <= 120
}

type SessionBookmarkMutation =
  | { readonly action: "set"; readonly projectId: string; readonly sessionId: string; readonly bookmarked: boolean }
  | { readonly action: "reorder"; readonly projectId: string; readonly sessionId: string; readonly direction: "up" | "down" }

function isSessionBookmarkMutation(value: unknown): value is SessionBookmarkMutation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.projectId !== "string" || typeof record.sessionId !== "string") return false
  if (record.action === "set") return Object.keys(record).length === 4 && typeof record.bookmarked === "boolean"
  return record.action === "reorder" && Object.keys(record).length === 4 && (record.direction === "up" || record.direction === "down")
}

type ProjectBookmarkMutation =
  | { readonly action: "set"; readonly projectId: string; readonly bookmarked: boolean }
  | { readonly action: "reorder"; readonly projectId: string; readonly direction: "up" | "down" }

function isProjectBookmarkMutation(value: unknown): value is ProjectBookmarkMutation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.projectId !== "string") return false
  if (record.action === "set") return Object.keys(record).length === 3 && typeof record.bookmarked === "boolean"
  return record.action === "reorder" && Object.keys(record).length === 3 && (record.direction === "up" || record.direction === "down")
}

function isSessionHostRequest(value: unknown): value is { readonly root: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1
    && typeof (value as Record<string, unknown>).root === "string"
}

async function resolveNewSessionProject(store: ProjectStore, key: SessionKey, cwd: string | undefined): Promise<Project> {
  const configured = (await store.read()).find((project) => project.id === key.projectId)
  if (configured !== undefined) return configured
  if (cwd === undefined) throw new HttpError(404, "Project not found")
  const root = await realpath(cwd)
  if (stableProjectId(root) !== key.projectId) throw new HttpError(404, "Project not found")
  return { id: key.projectId, root }
}

function isProjectCreate(value: unknown): value is { readonly root: string; readonly name?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return (keys.length === 1 || (keys.length === 2 && keys.includes("name")))
    && typeof record.root === "string"
    && (record.name === undefined || isProjectName(record.name))
}

function isProjectRename(value: unknown): value is { readonly name: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1
    && isProjectName((value as Record<string, unknown>).name)
}

export async function listDirectories(requested: string | null, showHidden: boolean): Promise<unknown> {
  const path = await realpath(requested ?? homedir())
  if (!(await stat(path)).isDirectory()) throw new HttpError(400, "Path is not a directory")
  const entries = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => showHidden || !entry.name.startsWith("."))
  const directories = (await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(path, entry.name)
    if (entry.isDirectory()) return directoryEntry(entryPath)
    if (!entry.isSymbolicLink()) return undefined
    return (await stat(entryPath).catch(() => undefined))?.isDirectory() === true ? directoryEntry(entryPath) : undefined
  }))).filter((entry) => entry !== undefined).slice(0, 500)
  const parentPath = dirname(path)
  return {
    current: directoryEntry(path),
    ...(parentPath === path ? {} : { parent: directoryEntry(parentPath) }),
    directories,
  }
}

function directoryEntry(path: string): { readonly name: string; readonly path: string; readonly displayPath: string } {
  return { name: basename(path) || path, path, displayPath: path }
}

interface SessionRoute {
  readonly key: SessionKey
  readonly action?: "events" | "history" | "turn" | "steer" | "follow-up" | "queue" | "abort" | "approval" | "undo" | "clone" | "reload" | "move" | "state" | "name" | "model" | "thinking" | "read" | "shared-files"
}

function isUndoRequest(value: unknown): value is { readonly entryId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 1 && typeof record.entryId === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(record.entryId)
}

interface SessionAttachmentRoute { readonly key: SessionKey; readonly attachmentId?: string }
function parseSessionAttachmentRoute(pathname: string): SessionAttachmentRoute | undefined {
  const match = /^\/v2\/projects\/([^/]+)\/sessions\/([^/]+)\/attachments(?:\/([A-Za-z0-9_-]{1,64}))?$/u.exec(pathname)
  if (match === null) return undefined
  const projectId = decodeRouteId(match[1]!); const sessionId = decodeRouteId(match[2]!)
  if (projectId === undefined || sessionId === undefined) return undefined
  return { key: { projectId, sessionId }, ...(match[3] === undefined ? {} : { attachmentId: match[3] }) }
}

interface SessionImageRoute {
  readonly key: SessionKey
  readonly imageId: string
}

function parseSessionImageRoute(pathname: string): SessionImageRoute | undefined {
  const match = /^\/v2\/projects\/([^/]+)\/sessions\/([^/]+)\/images\/([A-Za-z0-9_-]{1,512})$/u.exec(pathname)
  if (match === null) return undefined
  const projectId = decodeRouteId(match[1]!)
  const sessionId = decodeRouteId(match[2]!)
  if (projectId === undefined || sessionId === undefined) return undefined
  return { key: { projectId, sessionId }, imageId: match[3]! }
}

function decodeRouteId(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    return isProtocolId(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function parseSessionRoute(pathname: string): SessionRoute | undefined {
  const match = /^\/v2\/projects\/([^/]+)\/sessions\/([^/]+)(?:\/(events|history|turn|steer|follow-up|queue|abort|approval|undo|clone|reload|move|state|name|model|thinking|read|shared-files))?$/.exec(pathname)
  if (match === null) return undefined
  const projectId = decodeURIComponent(match[1]!)
  const sessionId = decodeURIComponent(match[2]!)
  if (!isProtocolId(projectId) || !isProtocolId(sessionId)) return undefined
  const action = match[3] as SessionRoute["action"]
  return { key: { projectId, sessionId }, ...(action === undefined ? {} : { action }) }
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const

async function readCommandInventory(turns: TurnService, key: SessionKey, sessionPath: string, cwd: string): Promise<readonly CommandSummary[]> {
  const response = await turns.control(key, sessionPath, cwd, { type: "get_commands" })
  const data = asRecord(response.data)
  const commands: readonly unknown[] = Array.isArray(data?.commands) ? data.commands as unknown[] : []
  return commands.flatMap((value): CommandSummary[] => {
    const command = asRecord(value)
    if (typeof command?.name !== "string" || command.name.length === 0 || command.name.length > 120) return []
    if (command.source !== "extension" && command.source !== "prompt-template" && command.source !== "skill") return []
    if (command.invocation !== "prompt" && command.invocation !== "direct") return []
    const description = typeof command.description === "string" && command.description.length <= 500 ? command.description : undefined
    return [{ name: command.name, ...(description === undefined ? {} : { description }), source: command.source, invocation: command.invocation }]
  }).slice(0, 1_000)
}

async function readSessionSettings(turns: TurnService, key: SessionKey, sessionPath: string, cwd: string): Promise<SessionSettings> {
  const [stateResponse, modelsResponse, thinkingLevelsResponse] = await Promise.all([
    turns.control(key, sessionPath, cwd, { type: "get_state" }),
    turns.control(key, sessionPath, cwd, { type: "get_available_models" }),
    turns.control(key, sessionPath, cwd, { type: "get_available_thinking_levels" }),
  ])
  const state = asRecord(stateResponse.data)
  const model = modelChoice(state?.model)
  const modelsData = asRecord(modelsResponse.data)
  const rawModels: readonly unknown[] = Array.isArray(modelsData?.models) ? modelsData.models as unknown[] : []
  const modelInventory = rawModels.flatMap((value): ModelChoice[] => {
    const choice = modelChoice(value)
    return choice === undefined ? [] : [choice]
  }).slice(0, 256)
  const selectedRaw = rawModels.find((value) => {
    const choice = modelChoice(value)
    return choice !== undefined && model !== undefined
      && choice.provider === model.provider && choice.modelId === model.modelId
  })
  const thinkingLevel = typeof state?.thinkingLevel === "string" && THINKING_LEVELS.includes(state.thinkingLevel as ThinkingLevel)
    ? state.thinkingLevel as ThinkingLevel : undefined
  return {
    ...(model === undefined ? {} : { model }),
    modelInventory,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    supportedThinkingLevels: supportedThinkingLevels(thinkingLevelsResponse.data, selectedRaw),
  }
}

function modelChoice(value: unknown): ModelChoice | undefined {
  const model = asRecord(value)
  if (model === undefined || typeof model.provider !== "string" || typeof model.id !== "string") return undefined
  const displayName = typeof model.name === "string" ? model.name : undefined
  return { provider: model.provider, modelId: model.id, ...(displayName === undefined ? {} : { displayName }) }
}

function supportedThinkingLevels(responseData: unknown, value: unknown): readonly ThinkingLevel[] {
  const levelsData = asRecord(responseData)
  const reportedLevels = levelsData?.levels
  if (Array.isArray(reportedLevels)) {
    const levels = THINKING_LEVELS.filter((level) => reportedLevels.includes(level))
    if (levels.length > 0) return levels
  }
  const model = asRecord(value)
  if (model?.reasoning !== true) return ["off"]
  const map = asRecord(model.thinkingLevelMap)
  if (map !== undefined) return THINKING_LEVELS.filter((level) => map[level] !== null && map[level] !== undefined)
  return ["off", "low", "medium", "high"]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

async function findProject(store: ProjectStore, id: string): Promise<Project> {
  const project = (await store.read()).find((item) => item.id === id)
  if (project === undefined) throw new HttpError(409, "Project is not configured")
  return project
}

async function requireEmptyJsonObject(request: IncomingMessage): Promise<void> {
  const value = await readJsonBody(request)
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length > 0) {
    throw new HttpError(400, "Request body must be an empty object")
  }
}

function sendHistoryImage(
  response: ServerResponse,
  image: SavedTimelineImage,
): void {
  response.writeHead(200, {
    "content-type": image.mediaType,
    "content-length": image.data.length,
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": "inline",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": WEB_ORIGIN,
    vary: "Origin",
  })
  response.end(image.data)
}

function openSystemThemeStream(
  request: IncomingMessage,
  response: ServerResponse,
  themes: SystemThemeService,
  streams: Set<ServerResponse>,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "access-control-allow-origin": WEB_ORIGIN,
    vary: "Origin",
  })
  streams.add(response)
  response.write(": connected\n\n")
  let closed = false
  let delivered = false
  const deliver = (theme: Awaited<ReturnType<SystemThemeService["read"]>>): void => {
    if (closed) return
    delivered = true
    response.write(`event: system-theme.changed\ndata: ${JSON.stringify(theme)}\n\n`)
  }
  const unsubscribe = themes.subscribe(deliver)
  void themes.read().then((theme) => { if (!delivered) deliver(theme) })
  request.once("close", () => { closed = true; streams.delete(response); unsubscribe() })
}

function openNativeNotificationStream(
  request: IncomingMessage,
  response: ServerResponse,
  notifications: NotificationService,
  url: URL,
  streams: Set<ServerResponse>,
): void {
  const deviceId = url.searchParams.get("deviceId")
  const unsubscribe = notifications.subscribeNative(deviceId, (payload) => {
    response.write(`event: notification\ndata: ${JSON.stringify({ version: PROTOCOL_VERSION, payload })}\n\n`)
  })
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "access-control-allow-origin": WEB_ORIGIN,
    vary: "Origin",
  })
  streams.add(response)
  response.write(": connected\n\n")
  request.once("close", () => { streams.delete(response); unsubscribe() })
}

function openSessionUpdates(
  request: IncomingMessage,
  response: ServerResponse,
  updates: SessionUpdates,
  url: URL,
  streams: Set<ServerResponse>,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "access-control-allow-origin": WEB_ORIGIN,
    vary: "Origin",
  })
  streams.add(response)
  response.write(": connected\n\n")
  const header = request.headers["last-event-id"]
  const requested = url.searchParams.get("after")
  const parsed = Number.parseInt(typeof header === "string" ? header : requested ?? "0", 10)
  const unsubscribe = updates.subscribe(response, Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0)
  request.once("close", () => { streams.delete(response); unsubscribe() })
}

function openEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  key: SessionKey,
  journal: EventJournal,
  phase: { readonly phase: "working" | "idle"; readonly epoch: string; readonly generation: number },
  streams: Set<ServerResponse>,
  watch?: () => () => void,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "access-control-allow-origin": WEB_ORIGIN,
    vary: "Origin",
  })
  streams.add(response)
  const header = request.headers["last-event-id"]
  const requested = new URL(request.url ?? "/", `http://${HOST}`).searchParams.get("after")
  const parsed = Number.parseInt(typeof header === "string" ? header : requested ?? "0", 10)
  const unsubscribeJournal = journal.subscribe(key, response, Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0)
  const unsubscribeWatch = watch?.()
  response.write(encodeSse({ version: 2, type: "phase", phase: phase.phase, epoch: phase.epoch, generation: phase.generation }))
  request.once("close", () => {
    streams.delete(response)
    unsubscribeJournal()
    unsubscribeWatch?.()
  })
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
}

const VOICE_AUDIO_TYPES = new Map([["audio/webm", "webm"], ["audio/mp4", "mp4"], ["audio/ogg", "ogg"], ["audio/mpeg", "mp3"], ["audio/wav", "wav"]])

async function readVoiceAudio(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > 12 * 1024 * 1024) throw new HttpError(413, "Voice recording is too large")
    chunks.push(Buffer.from(chunk))
  }
  const audio = Buffer.concat(chunks)
  if (audio.length === 0) throw new HttpError(400, "Voice recording is empty")
  return audio
}

async function serveVoiceRequest(request: IncomingMessage, response: ServerResponse, pathname: string, settings: VoiceSettingsStore): Promise<void> {
  try {
    if (pathname === "/v2/voice/settings" && request.method === "GET") { sendJson(response, 200, { version: PROTOCOL_VERSION, settings: await settings.read() }); return }
    if (pathname === "/v2/voice/settings" && request.method === "PUT") { assertJsonMutation(request); sendJson(response, 200, { version: PROTOCOL_VERSION, settings: await settings.update(await readJsonBody(request)) }); return }
    if (pathname === "/v2/voice/settings/openai-key" && request.method === "PUT") { assertJsonMutation(request); const body = await readJsonBody(request) as { apiKey?: unknown }; sendJson(response, 200, { version: PROTOCOL_VERSION, settings: await settings.setOpenAiKey(body.apiKey) }); return }
    if (pathname === "/v2/voice/settings/openai-key" && request.method === "DELETE") { sendJson(response, 200, { version: PROTOCOL_VERSION, settings: await settings.removeOpenAiKey() }); return }
    const apiKey = await settings.openAiKey()
    if (pathname === "/v2/voice/capabilities" && request.method === "GET") { sendJson(response, 200, { version: PROTOCOL_VERSION, transcription: apiKey !== undefined, speech: apiKey !== undefined }); return }
    if (pathname === "/v2/voice/settings/openai-key/test" && request.method === "POST") {
      if (apiKey === undefined) throw new HttpError(409, "OpenAI API key is not configured")
      const provider = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) })
      if (!provider.ok) throw new HttpError(422, "OpenAI API key test failed")
      sendJson(response, 200, { version: PROTOCOL_VERSION, valid: true }); return
    }
    if (pathname === "/v2/voice/transcriptions" && request.method === "POST") {
      if (apiKey === undefined) throw new HttpError(409, "OpenAI API key is not configured")
      const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase(); const extension = mediaType === undefined ? undefined : VOICE_AUDIO_TYPES.get(mediaType)
      if (mediaType === undefined || extension === undefined) throw new HttpError(415, "Voice recording type is not supported")
      const form = new FormData(); form.append("file", new Blob([Uint8Array.from(await readVoiceAudio(request))], { type: mediaType }), `recording.${extension}`); form.append("model", (await settings.read()).transcriptionModel)
      const provider = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(45_000) })
      if (!provider.ok) throw new HttpError(provider.status === 401 || provider.status === 403 ? 422 : 502, "Voice transcription failed")
      const result = await provider.json() as { text?: unknown }; if (typeof result.text !== "string" || result.text.trim() === "") throw new HttpError(502, "Voice transcription failed")
      sendJson(response, 200, { version: PROTOCOL_VERSION, text: result.text.trim() }); return
    }
    if (pathname === "/v2/voice/speech" && request.method === "POST") {
      if (apiKey === undefined) throw new HttpError(409, "OpenAI API key is not configured")
      assertJsonMutation(request); const body = await readJsonBody(request) as { text?: unknown }
      if (typeof body.text !== "string" || body.text.trim() === "" || body.text.length > 12_000) throw new HttpError(400, "Speech text is invalid")
      const configured = await settings.read(); const provider = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: configured.speechModel, voice: configured.speechVoice, speed: 1, input: body.text, response_format: "mp3" }), signal: AbortSignal.timeout(45_000) })
      if (!provider.ok) throw new HttpError(provider.status === 401 || provider.status === 403 ? 422 : 502, "Voice response failed")
      response.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" }); response.end(Buffer.from(await provider.arrayBuffer())); return
    }
    throw new HttpError(405, "Voice request method is not allowed")
  } catch (error) { if (error instanceof VoiceSettingsError) throw new HttpError(400, error.message); throw error }
}

async function serveWeb(response: ServerResponse, webRoot: string, pathname: string): Promise<void> {
  const root = resolve(webRoot)
  const requested = resolve(root, `.${pathname}`)
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    throw new HttpError(404, "Not found")
  }
  let path = requested
  try {
    if (!(await stat(path)).isFile()) path = resolve(root, "index.html")
  } catch {
    path = resolve(root, "index.html")
  }
  const body = await readFile(path)
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": body.byteLength,
    "cache-control": shouldRevalidate(path) ? "no-cache" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

function shouldRevalidate(path: string): boolean {
  return path.endsWith("index.html")
    || path.endsWith("sw.js")
    || path.endsWith("registerSW.js")
    || path.endsWith("manifest.webmanifest")
}

function sendSharedFileError(response: ServerResponse, error: unknown): void {
  const status = error instanceof SharedFileError ? error.status : 500
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...(status === 405 ? { allow: "GET, HEAD, PUT" } : {}),
  })
  response.end(status === 404 ? "Shared file not found" : "Shared file request failed")
}

export async function shutdownPiStationServer(server: Server, timeoutMs = 60_000): Promise<void> {
  const context = shutdownContexts.get(server)
  if (context === undefined) throw new Error("Pi Station server shutdown context is unavailable")
  await context.shutdown(timeoutMs)
}

export function listenLocal(server: Server, port = 8801): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, HOST, () => resolve())
  })
}
