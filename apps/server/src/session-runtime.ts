import { randomUUID } from "node:crypto"
import {
  createAgentSession,
  createBashTool,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import type { Project } from "@pi-station/application-protocol"
import type { AgentMessagingBridge } from "./agent-messaging.js"
import type { SessionMoveAgentBridge } from "./session-moves.js"
import type { DelegationEvents, DelegationRecord } from "./delegations.js"
import type { NewAgentInProjectBridge } from "./new-agent-in-project.js"
import type { SessionDefaults } from "./session-defaults.js"
import { DELEGATION_REPORT_CUSTOM_TYPE, type DelegationReportStatus } from "./delegation-report.js"
import { sharedFileInstructions, type SharedFileOrigins } from "./shared-files.js"
import type { ScheduledJobAgentBridge } from "./scheduled-jobs.js"
import type { CommandApprovalService } from "./command-approval.js"
import { isolateToolProcess } from "./tool-process-execution.js"
import { agentsLocalExtension } from "./agents-local-extension.js"

export const DELEGATION_TOOL_NAME = "delegate_to_agent"
export const CLOSE_DELEGATED_AGENT_TOOL_NAME = "close_delegated_agent"
export const RECOVER_DELEGATED_AGENT_TOOL_NAME = "recover_delegated_agent"
export const MAX_ACTIVE_DELEGATIONS_PER_SESSION = 20

export const DELEGATED_SESSION_EXCLUDED_TOOLS = [
  DELEGATION_TOOL_NAME,
  CLOSE_DELEGATED_AGENT_TOOL_NAME,
  RECOVER_DELEGATED_AGENT_TOOL_NAME,
  "delegate_to_background_agent",
  "delegate_to_interactive_agent",
  "list_agents",
  "resume_agent",
] as const

export interface RuntimeResponse {
  readonly type: "response"
  readonly command: string
  readonly success: boolean
  readonly data?: unknown
}

export type RuntimeControlCommand =
  | { readonly type: "get_state" }
  | { readonly type: "get_commands" }
  | { readonly type: "get_available_models" }
  | { readonly type: "get_available_thinking_levels" }
  | { readonly type: "reload" }
  | { readonly type: "undo_user_message"; readonly entryId: string }
  | { readonly type: "set_model"; readonly provider: string; readonly modelId: string }
  | { readonly type: "set_thinking_level"; readonly level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" }

export interface RuntimeAgentMessage {
  readonly fromSessionId: string
  readonly fromName?: string
  readonly message: string
}

export interface RuntimeAgentMention {
  readonly sessionId: string
  readonly label: string
}

export interface RuntimePromptImage {
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp"
  readonly data: string
}

export interface StartRuntimeTurn {
  readonly projectId: string
  readonly sessionId: string
  readonly session: "existing" | "new"
  readonly sessionPath?: string
  readonly cwd: string
  readonly prompt: string
  readonly images?: readonly RuntimePromptImage[]
  readonly name?: string
  readonly origin?: { readonly kind: "scheduled-job"; readonly jobId: string; readonly title: string }
  readonly attachmentMarker?: unknown
  readonly agentMentions?: readonly RuntimeAgentMention[]
  readonly agentMessage?: RuntimeAgentMessage
  readonly onEvent?: (event: RuntimeEvent) => void
}

export interface RuntimeEvent {
  readonly type: string
  readonly [key: string]: unknown
}

export interface RuntimeTurn {
  /** Settles only when the accepted SDK prompt settles or explicit ownership is lost. */
  readonly completion: Promise<unknown>
  readonly ownershipLost: Promise<never>
  steer(message: string, images?: readonly RuntimePromptImage[], attachmentMarker?: unknown, agentMentions?: readonly RuntimeAgentMention[]): Promise<void>
  followUp(message: string, images?: readonly RuntimePromptImage[], attachmentMarker?: unknown, agentMentions?: readonly RuntimeAgentMention[]): Promise<void>
  clearQueue?(): Promise<void>
  sendAgentMessage?(message: RuntimeAgentMessage): Promise<void>
  abort(): Promise<void>
  control(command: RuntimeControlCommand): Promise<RuntimeResponse>
}

export interface SessionRuntime {
  run(input: StartRuntimeTurn): RuntimeTurn
  readonly recoverDelegation?: (input: { readonly record: DelegationRecord; readonly cwd: string; readonly prompt: string; readonly onComplete: (report: { status: DelegationReportStatus; message: string }) => Promise<void> }) => Promise<DelegationRecord>
  control(input: { readonly projectId: string; readonly sessionId: string; readonly sessionPath: string; readonly cwd: string; readonly command: RuntimeControlCommand }): Promise<RuntimeResponse>
  sendAgentMessage?(input: { readonly sessionId: string; readonly cwd: string; readonly message: RuntimeAgentMessage }): Promise<boolean>
  deliver?(input: { readonly sessionId: string; readonly cwd: string; readonly delivery: "steer" | "followUp"; readonly message: string; readonly images?: readonly RuntimePromptImage[]; readonly attachmentMarker?: unknown; readonly agentMentions?: readonly RuntimeAgentMention[] }): Promise<boolean>
  abortSession?(input: { readonly sessionId: string; readonly cwd: string }): Promise<boolean>
  /** Explicitly interrupts all owned generations without deleting Pi history. */
  interruptOwned(): void
  dispose(): void
}

export type RuntimeSession = Pick<AgentSession,
  | "abort"
  | "clearQueue"
  | "dispose"
  | "followUp"
  | "getAvailableThinkingLevels"
  | "extensionRunner"
  | "promptTemplates"
  | "resourceLoader"
  | "isStreaming"
  | "model"
  | "messages"
  | "modelRuntime"
  | "navigateTree"
  | "prompt"
  | "sendCustomMessage"
  | "reload"
  | "sessionManager"
  | "setModel"
  | "setThinkingLevel"
  | "steer"
  | "subscribe"
  | "thinkingLevel"
>

export type RuntimeSessionFactory = (input: {
  readonly cwd: string
  readonly projectId?: string
  readonly sessionId: string
  readonly sessionPath?: string
  readonly mode: "existing" | "new"
  readonly delegated?: boolean
}) => Promise<RuntimeSession>

export function delegatedSessionSettings(parent: RuntimeSession): SessionDefaults {
  const model = parent.model
  if (model === undefined) throw new Error("Parent Session has no model")
  return {
    provider: model.provider,
    modelId: model.id,
    thinkingLevel: parent.thinkingLevel,
  }
}

export interface SdkSessionRuntimeOptions {
  readonly delegationEvents?: DelegationEvents
  readonly closeDelegatedAgent?: (input: { projectId: string; parentSessionId: string; childSessionId: string }) => Promise<void>
  readonly recoverDelegatedAgent?: (input: { projectId: string; parentSessionId: string; childSessionId: string }) => Promise<DelegationRecord>
  readonly sessionDefaults?: () => Promise<SessionDefaults>
  readonly modelRuntime?: ModelRuntime
  readonly sharedFiles?: { readonly directory: string; readonly origins: SharedFileOrigins }
  readonly scheduledJobs?: ScheduledJobAgentBridge
  readonly agentMessaging?: AgentMessagingBridge
  readonly listProjects?: () => Promise<readonly Project[]>
  readonly createProject?: (input: { readonly name: string; readonly directory: string }) => Promise<Project>
  readonly sessionMoves?: SessionMoveAgentBridge
  readonly newAgentInProject?: NewAgentInProjectBridge
  readonly commandApprovals?: CommandApprovalService
}

export function createSdkSessionRuntime(factory?: RuntimeSessionFactory, options: SdkSessionRuntimeOptions = {}): SessionRuntime {
  const sessions = new Map<string, Promise<RuntimeSession>>()
  const lifetime = runtimeLifetime()
  const ownedTurns = new Set<ReturnType<typeof runtimeLifetime>>()
  const activeDelegations = new Map<string, number>()
  const recoveringDelegations = new Set<string>()
  const startDelegation: (input: { projectId: string; parentSessionId: string; cwd: string; prompt: string; name?: string; settings: SessionDefaults; onComplete: (report: { status: DelegationReportStatus; message: string }) => Promise<void> }) => Promise<DelegationRecord> = async (input) => {
    const active = activeDelegations.get(input.parentSessionId) ?? 0
    if (active >= MAX_ACTIVE_DELEGATIONS_PER_SESSION) {
      throw new Error(`This Session already has ${MAX_ACTIVE_DELEGATIONS_PER_SESSION} active delegations`)
    }
    activeDelegations.set(input.parentSessionId, active + 1)
    const release = (): void => {
      const remaining = (activeDelegations.get(input.parentSessionId) ?? 1) - 1
      if (remaining === 0) activeDelegations.delete(input.parentSessionId)
      else activeDelegations.set(input.parentSessionId, remaining)
    }
    const id = randomUUID()
    const childSessionId = randomUUID()
    let session: RuntimeSession
    try {
      session = await acquire({ projectId: input.projectId, sessionId: childSessionId, cwd: input.cwd, mode: "new", delegated: true, settings: input.settings })
    } catch (error) {
      release()
      throw error
    }
    session.sessionManager.appendSessionInfo(input.name ?? "Delegated Session")
    const childPath = session.sessionManager.getSessionFile()
    if (childPath === undefined) throw new Error("Delegated Session file was not created")
    const now = new Date().toISOString()
    const record: DelegationRecord = { id, projectId: input.projectId, parentSessionId: input.parentSessionId, childSessionId, childPath, ...(input.name === undefined ? {} : { name: input.name }), status: "working", createdAt: now, updatedAt: now }
    options.delegationEvents?.publish({ type: "started", record })
    options.delegationEvents?.publishTurn({ type: "started", record })
    const unsubscribe = session.subscribe((event) => options.delegationEvents?.publishTurn({ type: "runtime-event", record, event }))
    const prompt = session.prompt(input.prompt)
    void Promise.race([prompt, lifetime.lost]).then(async () => {
      const completed = { ...record, status: "completed" as const, updatedAt: new Date().toISOString() }
      options.delegationEvents?.publish({ type: "completed", record: completed })
      options.delegationEvents?.publishTurn({ type: "finished", record: completed })
      const result = lastAssistantText(session.messages)
      await input.onComplete({
        status: "completed",
        message: `Delegation ${record.name ?? record.id} completed (child Session ${record.childSessionId}).${result === undefined ? "" : `\n\n${result}`}`,
      })
    }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Delegation failed"
      const failed = { ...record, status: error instanceof RuntimeLostError ? "interrupted" as const : "failed" as const, updatedAt: new Date().toISOString(), error: message }
      options.delegationEvents?.publish({ type: "failed", record: failed })
      options.delegationEvents?.publishTurn({ type: "finished", record: failed, error: message })
      await input.onComplete({ status: "failed", message: `Delegation ${record.name ?? record.id} failed: ${message}` })
    }).finally(() => {
      unsubscribe()
      release()
    }).catch(() => undefined)
    return record
  }
  const recoverDelegation = async (input: { record: DelegationRecord; cwd: string; prompt: string; onComplete: (report: { status: DelegationReportStatus; message: string }) => Promise<void> }): Promise<DelegationRecord> => {
    const { record } = input
    if (record.status !== "failed" && record.status !== "cancelled" && record.status !== "interrupted") {
      throw new Error("Only a failed, cancelled, or interrupted delegated Session can be recovered")
    }
    if (recoveringDelegations.has(record.id)) throw new Error("Delegated Session recovery is already in progress")
    recoveringDelegations.add(record.id)
    let session: RuntimeSession
    try {
      session = await acquire({ projectId: record.projectId, sessionId: record.childSessionId, sessionPath: record.childPath, cwd: input.cwd, mode: "existing", delegated: true })
      if (session.isStreaming) throw new Error("Delegated Session already has a Working runtime")
    } catch (error) {
      recoveringDelegations.delete(record.id)
      throw error
    }
    const working: DelegationRecord = {
      id: record.id,
      projectId: record.projectId,
      parentSessionId: record.parentSessionId,
      childSessionId: record.childSessionId,
      childPath: record.childPath,
      ...(record.name === undefined ? {} : { name: record.name }),
      status: "working",
      createdAt: record.createdAt,
      updatedAt: new Date().toISOString(),
    }
    options.delegationEvents?.publish({ type: "started", record: working })
    options.delegationEvents?.publishTurn({ type: "started", record: working })
    const unsubscribe = session.subscribe((event) => options.delegationEvents?.publishTurn({ type: "runtime-event", record: working, event }))
    const prompt = session.prompt(input.prompt)
    void Promise.race([prompt, lifetime.lost]).then(async () => {
      const completed = { ...working, status: "completed" as const, updatedAt: new Date().toISOString() }
      options.delegationEvents?.publish({ type: "completed", record: completed })
      options.delegationEvents?.publishTurn({ type: "finished", record: completed })
      const result = lastAssistantText(session.messages)
      await input.onComplete({ status: "completed", message: `Recovered delegation ${record.name ?? record.id} completed (child Session ${record.childSessionId}).${result === undefined ? "" : `\n\n${result}`}` })
    }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Recovered delegation failed"
      const failed = { ...working, status: error instanceof RuntimeLostError ? "interrupted" as const : "failed" as const, updatedAt: new Date().toISOString(), error: message }
      options.delegationEvents?.publish({ type: "failed", record: failed })
      options.delegationEvents?.publishTurn({ type: "finished", record: failed, error: message })
      await input.onComplete({ status: "failed", message: `Recovered delegation ${record.name ?? record.id} failed: ${message}` })
    }).finally(() => {
      unsubscribe()
      recoveringDelegations.delete(record.id)
    }).catch(() => undefined)
    return working
  }
  const createSession: RuntimeSessionFactory = factory ?? ((input) => createSdkSession(input, startDelegation, recoverDelegation, options))

  const acquire = (input: { projectId?: string; sessionId: string; cwd: string; sessionPath?: string; mode: "existing" | "new"; delegated?: boolean; settings?: SessionDefaults }): Promise<RuntimeSession> => {
    const key = `${input.cwd}\0${input.sessionId}`
    const existing = sessions.get(key)
    if (existing !== undefined) return existing
    const created = createSession(input).then(async (session) => {
      try {
        if (input.mode === "new" || needsPlaceholderDefaults(session)) {
          const settings = input.settings ?? await options.sessionDefaults?.()
          if (settings !== undefined) {
            const model = session.modelRuntime.getModel(settings.provider, settings.modelId)
            if (model === undefined) throw new Error(`Default model not found: ${settings.provider}/${settings.modelId}`)
            await session.setModel(model)
            session.setThinkingLevel(settings.thinkingLevel)
            session.sessionManager.appendCustomEntry("pi-station-session-defaults-applied")
          }
        }
        return session
      } catch (error) {
        session.dispose()
        throw error
      }
    }).catch((error: unknown) => {
      sessions.delete(key)
      throw error
    })
    sessions.set(key, created)
    return created
  }

  const executeControl = async (session: RuntimeSession, command: RuntimeControlCommand): Promise<RuntimeResponse> => {
    if (command.type === "set_model") {
      const model = session.modelRuntime.getModel(command.provider, command.modelId)
      if (model === undefined) throw new Error(`Model not found: ${command.provider}/${command.modelId}`)
      await session.setModel(model)
    } else if (command.type === "set_thinking_level") {
      session.setThinkingLevel(command.level)
    } else if (command.type === "undo_user_message") {
      if (session.isStreaming) throw new Error("Working Session cannot undo a message")
      const entry = session.sessionManager.getEntry(command.entryId)
      const activeEntryIds = new Set(session.sessionManager.getBranch().map((item) => item.id))
      if (entry?.type !== "message" || entry.message.role !== "user" || !activeEntryIds.has(entry.id)) {
        throw new Error("User message is not on the active Session branch")
      }
      if (entry.parentId === null) throw new Error("The first Session entry cannot be undone")
      await session.navigateTree(entry.parentId, { summarize: false })
      // Persist the new leaf. Native tree navigation is otherwise in memory until
      // another entry is appended, which lets a Workspace refresh show the old leaf.
      session.sessionManager.appendCustomEntry("pi-station-undo", { entryId: entry.id })
    } else if (command.type === "reload") {
      throw new Error("Reload must replace the SDK Session runtime")
    }

    if (command.type === "get_commands") {
      const extensions = session.extensionRunner.getRegisteredCommands().map((item) => ({
        name: item.invocationName,
        ...(item.description === undefined ? {} : { description: item.description }),
        source: "extension" as const,
        invocation: "direct" as const,
      }))
      const prompts = session.promptTemplates.map((item) => ({ name: item.name, description: item.description, source: "prompt-template" as const, invocation: "prompt" as const }))
      const skills = session.resourceLoader.getSkills().skills.map((item) => ({ name: `skill:${item.name}`, description: item.description, source: "skill" as const, invocation: "prompt" as const }))
      return { type: "response", command: command.type, success: true, data: { commands: [...extensions, ...prompts, ...skills] } }
    }
    if (command.type === "get_available_models") {
      return { type: "response", command: command.type, success: true, data: { models: session.modelRuntime.getAvailableSnapshot() } }
    }
    if (command.type === "get_available_thinking_levels") {
      return { type: "response", command: command.type, success: true, data: { levels: session.getAvailableThinkingLevels() } }
    }
    return {
      type: "response",
      command: command.type,
      success: true,
      data: { model: session.model, thinkingLevel: session.thinkingLevel },
    }
  }

  return {
    recoverDelegation,
    run(input): RuntimeTurn {
      const ownership = runtimeLifetime()
      ownedTurns.add(ownership)
      const ready = acquire({
        projectId: input.projectId,
        sessionId: input.sessionId,
        cwd: input.cwd,
        mode: input.session,
        ...(input.sessionPath === undefined ? {} : { sessionPath: input.sessionPath }),
      })
      const completion = ready.then(async (session) => {
        if (input.name !== undefined && input.session === "new") session.sessionManager.appendSessionInfo(input.name)
        if (input.origin !== undefined) await session.sendCustomMessage({ customType: "pi-station-scheduled-job", content: `Scheduled Job: ${input.origin.title}`, display: true, details: input.origin }, { triggerTurn: false })
        if (input.attachmentMarker !== undefined) await session.sendCustomMessage({ customType: "pi-station-attachments", content: "Attached files", display: false, details: input.attachmentMarker }, { triggerTurn: false })
        if (input.agentMentions !== undefined) await sendAgentMentionContext(session, input.agentMentions)
        const unsubscribe = input.onEvent === undefined ? undefined : session.subscribe((event) => input.onEvent?.(event))
        try {
          const prompt = input.agentMessage === undefined
            ? input.images === undefined
              ? session.prompt(input.prompt)
              : session.prompt(input.prompt, { images: sdkImages(input.images) })
            : sendInboundAgentMessage(session, input.agentMessage)
          await Promise.race([prompt, ownership.lost, lifetime.lost])
        } finally {
          unsubscribe?.()
        }
      }).finally(() => { ownedTurns.delete(ownership) })
      return {
        completion,
        ownershipLost: ownership.lost,
        steer(message, images, attachmentMarker, agentMentions) {
          return ready.then(async (session) => {
            if (attachmentMarker !== undefined) await session.sendCustomMessage({ customType: "pi-station-attachments", content: "Attached files", display: false, details: attachmentMarker }, { triggerTurn: false })
            if (agentMentions !== undefined) await sendAgentMentionContext(session, agentMentions, "steer")
            return images === undefined ? session.steer(message) : session.prompt(message, { images: sdkImages(images), streamingBehavior: "steer" })
          })
        },
        followUp(message, images, attachmentMarker, agentMentions) {
          return ready.then(async (session) => {
            if (attachmentMarker !== undefined) await session.sendCustomMessage({ customType: "pi-station-attachments", content: "Attached files", display: false, details: attachmentMarker }, { triggerTurn: false })
            if (agentMentions !== undefined) await sendAgentMentionContext(session, agentMentions, "followUp")
            return images === undefined ? session.followUp(message) : session.prompt(message, { images: sdkImages(images), streamingBehavior: "followUp" })
          })
        },
        clearQueue() { return ready.then((session) => { session.clearQueue() }) },
        sendAgentMessage(message) {
          return ready.then((session) => sendInboundAgentMessage(session, message, "steer"))
        },
        abort() { return ready.then((session) => session.abort()) },
        control(command) { return ready.then((session) => executeControl(session, command)) },
      }
    },
    async abortSession(input) {
      const current = sessions.get(`${input.cwd}\0${input.sessionId}`)
      if (current === undefined) return false
      const session = await current
      if (!session.isStreaming) return false
      await session.abort()
      return true
    },
    async sendAgentMessage(input) {
      const current = sessions.get(`${input.cwd}\0${input.sessionId}`)
      if (current === undefined) return false
      const session = await current
      await sendInboundAgentMessage(session, input.message, session.isStreaming ? "steer" : undefined)
      return true
    },
    async deliver(input) {
      const current = sessions.get(`${input.cwd}\0${input.sessionId}`)
      if (current === undefined) return false
      const session = await current
      if (!session.isStreaming) return false
      if (input.attachmentMarker !== undefined) await session.sendCustomMessage({ customType: "pi-station-attachments", content: "Attached files", display: false, details: input.attachmentMarker }, { triggerTurn: false })
      if (input.agentMentions !== undefined) await sendAgentMentionContext(session, input.agentMentions, input.delivery)
      if (input.images === undefined) {
        if (input.delivery === "steer") await session.steer(input.message)
        else await session.followUp(input.message)
      } else {
        await session.prompt(input.message, { images: sdkImages(input.images), streamingBehavior: input.delivery })
      }
      return true
    },
    async control(input) {
      if (input.command.type === "reload") {
        const key = `${input.cwd}\0${input.sessionId}`
        const current = sessions.get(key)
        if (current !== undefined) {
          const session = await current
          if (session.isStreaming) throw new Error("Working Session cannot be reloaded")
          session.dispose()
          sessions.delete(key)
        }
        const replacement = await acquire({
          projectId: input.projectId,
          sessionId: input.sessionId,
          cwd: input.cwd,
          sessionPath: input.sessionPath,
          mode: "existing",
        })
        return {
          type: "response",
          command: input.command.type,
          success: true,
          data: { model: replacement.model, thinkingLevel: replacement.thinkingLevel },
        }
      }
      const session = await acquire({
        projectId: input.projectId,
        sessionId: input.sessionId,
        cwd: input.cwd,
        sessionPath: input.sessionPath,
        mode: "existing",
      })
      return executeControl(session, input.command)
    },
    interruptOwned() {
      for (const ownership of ownedTurns) ownership.lose()
      for (const pending of sessions.values()) void pending.then((session) => session.abort()).catch(() => undefined)
    },
    dispose() {
      lifetime.lose()
      for (const ownership of ownedTurns) ownership.lose()
      ownedTurns.clear()
      for (const pending of sessions.values()) void pending.then((session) => {
        void session.abort().catch(() => undefined)
        session.dispose()
      })
      sessions.clear()
    },
  }
}

function needsPlaceholderDefaults(session: RuntimeSession): boolean {
  const entries = session.sessionManager.getBranch()
  const placeholder = entries.some((entry) => entry.type === "custom"
    && (entry.customType === "pi-station-empty-session" || entry.customType === "pi-station-quick-session"))
  if (!placeholder) return false
  return !entries.some((entry) => entry.type === "model_change"
    || entry.type === "thinking_level_change"
    || (entry.type === "custom" && entry.customType === "pi-station-session-defaults-applied"))
}

async function createSdkSession(input: {
  readonly cwd: string
  readonly projectId?: string
  readonly sessionId: string
  readonly sessionPath?: string
  readonly mode: "existing" | "new"
  readonly delegated?: boolean
}, delegate: (input: { projectId: string; parentSessionId: string; cwd: string; prompt: string; name?: string; settings: SessionDefaults; onComplete: (report: { status: DelegationReportStatus; message: string }) => Promise<void> }) => Promise<DelegationRecord>, recover: (input: { record: DelegationRecord; cwd: string; prompt: string; onComplete: (report: { status: DelegationReportStatus; message: string }) => Promise<void> }) => Promise<DelegationRecord>, options: SdkSessionRuntimeOptions): Promise<RuntimeSession> {
  const sessionManager = input.mode === "existing"
    ? SessionManager.open(requiredSessionPath(input), undefined, input.cwd)
    : SessionManager.create(input.cwd, undefined, { id: input.sessionId })
  const parent = { session: undefined as RuntimeSession | undefined }
  const delegationTools = input.delegated === true || input.projectId === undefined ? [] : [defineTool({
    name: DELEGATION_TOOL_NAME,
    label: "Delegate",
    description: "Start an independent Pi Station child Session for a bounded task. The child Session appears nested under this Session and inherits its model and thinking level.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Complete, self-contained task instructions" }),
      name: Type.Optional(Type.String({ description: "Short child Session name" })),
    }, { additionalProperties: false }),
    execute: async (toolCallId, parameters) => {
      if (input.projectId === undefined) throw new Error("Delegation requires a Project")
      if (parent.session === undefined) throw new Error("Delegation requires an active parent Session")
      const record = await delegate({
        projectId: input.projectId,
        parentSessionId: input.sessionId,
        cwd: input.cwd,
        prompt: parameters.prompt,
        settings: delegatedSessionSettings(parent.session),
        ...(parameters.name === undefined ? {} : { name: parameters.name }),
        onComplete: async (report) => {
          if (parent.session === undefined) return
          await deliverDelegationReport(parent.session, toolCallId, report)
        },
      })
      return { content: [{ type: "text", text: `Delegation started: ${record.id} (Session ${record.childSessionId})` }], details: { delegationId: record.id, childSessionId: record.childSessionId } }
    },
  }), defineTool({
    name: RECOVER_DELEGATED_AGENT_TOOL_NAME,
    label: "Recover delegated agent",
    description: "Resume the same saved direct child Session after a failed, cancelled, or interrupted delegation. This keeps its Session identity and history.",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Existing child Session ID returned by delegate_to_agent" }),
      prompt: Type.String({ description: "Instructions for the resumed child Session" }),
    }),
    execute: async (toolCallId, parameters) => {
      if (input.projectId === undefined) throw new Error("Recovering a delegated agent requires a Project")
      if (parent.session === undefined) throw new Error("Recovery requires an active parent Session")
      if (options.recoverDelegatedAgent === undefined) throw new Error("Recovering delegated agents is unavailable")
      const record = await options.recoverDelegatedAgent({ projectId: input.projectId, parentSessionId: input.sessionId, childSessionId: parameters.sessionId })
      const working = await recover({
        record,
        cwd: input.cwd,
        prompt: parameters.prompt,
        onComplete: async (report) => {
          if (parent.session !== undefined) await deliverDelegationReport(parent.session, toolCallId, report)
        },
      })
      return { content: [{ type: "text", text: `Delegation recovery started: ${working.id} (Session ${working.childSessionId})` }], details: { delegationId: working.id, childSessionId: working.childSessionId } }
    },
  }), defineTool({
    name: CLOSE_DELEGATED_AGENT_TOOL_NAME,
    label: "Close delegated agent",
    description: "Close one completed or failed child Session that was delegated directly by this Session. The child history remains available to open later.",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Child Session ID returned by delegate_to_agent" }),
    }),
    execute: async (_toolCallId, parameters) => {
      if (input.projectId === undefined) throw new Error("Closing a delegated agent requires a Project")
      if (options.closeDelegatedAgent === undefined) throw new Error("Closing delegated agents is unavailable")
      await options.closeDelegatedAgent({ projectId: input.projectId, parentSessionId: input.sessionId, childSessionId: parameters.sessionId })
      return { content: [{ type: "text", text: `Closed delegated agent Session ${parameters.sessionId}` }], details: { childSessionId: parameters.sessionId } }
    },
  })]
  const agentMessagingTools = options.agentMessaging === undefined ? [] : [defineTool({
    name: "send_agent_message",
    label: "Send agent message",
    description: "Send a message to another open Pi Station Session. The message starts a turn when the target agent is idle and steers it when the target agent is working.",
    parameters: Type.Object({
      sessionId: Type.String({ minLength: 1, maxLength: 200, description: "Target Session ID" }),
      message: Type.String({ minLength: 1, maxLength: 100_000, description: "Message for the target agent" }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, parameters) => {
      if (parameters.sessionId === input.sessionId) throw new Error("An agent cannot send a message to itself")
      const delivered = await options.agentMessaging!.invoke({
        fromSessionId: input.sessionId,
        sessionId: parameters.sessionId,
        message: parameters.message,
      })
      return {
        content: [{ type: "text", text: `Message ${delivered.delivery === "steer" ? "steered" : "started a turn for"} Session ${parameters.sessionId}` }],
        details: { sessionId: parameters.sessionId, delivery: delivered.delivery },
      }
    },
  })]
  const sessionMoveTools = options.sessionMoves === undefined ? [] : moveSessionTools(options.sessionMoves, input.sessionId, input.projectId, input.delegated === true)
  const scheduledJobTools = input.projectId === undefined || options.scheduledJobs === undefined ? [] : scheduledTools(options.scheduledJobs, input.projectId, input.sessionId)
  const projectListingTools = input.projectId === undefined || options.listProjects === undefined
    ? []
    : listProjectsTools(options.listProjects, input.projectId, input.delegated === true)
  const newAgentTools = input.projectId === undefined || options.newAgentInProject === undefined
    ? []
    : newAgentInProjectTools(options.newAgentInProject, input.delegated === true)
  const projectCreationTools = input.projectId === undefined || options.createProject === undefined
    ? []
    : createProjectTools(options.createProject, input.delegated === true)
  const sharedFiles = options.sharedFiles
  const commandApprovalExtension = input.projectId === undefined || options.commandApprovals === undefined
    ? []
    : [options.commandApprovals.extension({ projectId: input.projectId, sessionId: input.sessionId })]
  const agentDir = getAgentDir()
  const resourceLoader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir,
    extensionFactories: [agentsLocalExtension(agentDir), ...commandApprovalExtension],
    ...(sharedFiles === undefined ? {} : {
      appendSystemPromptOverride: (base) => [
        ...base,
        sharedFileInstructions(sharedFiles.directory, sharedFiles.origins, input.sessionId, input.projectId),
      ],
    }),
  })
  await resourceLoader.reload()
  const bashTool = createBashTool(input.cwd, { spawnHook: isolateToolProcess })
  const { session } = await createAgentSession({
    cwd: input.cwd,
    sessionManager,
    customTools: [bashTool, ...delegationTools, ...agentMessagingTools, ...sessionMoveTools, ...scheduledJobTools, ...projectListingTools, ...projectCreationTools, ...newAgentTools],
    resourceLoader,
    ...(options.modelRuntime === undefined ? {} : { modelRuntime: options.modelRuntime }),
    excludeTools: input.delegated === true
      ? [...DELEGATED_SESSION_EXCLUDED_TOOLS]
      : ["delegate_to_background_agent"],
  })
  parent.session = session
  return session
}

export function newAgentInProjectTools(bridge: NewAgentInProjectBridge, delegated = false) {
  if (delegated) return []
  return [defineTool({
    name: "new_agent_in_project",
    label: "New agent in Project",
    description: "Start a new independent top-level agent Session in a specified Pi Station Project. It uses the Project working directory and default model settings, and it immediately receives the prompt. It is not a delegated agent.",
    parameters: Type.Object({
      projectId: Type.String({ minLength: 1, maxLength: 200, description: "Exact Project ID" }),
      name: Type.String({ minLength: 1, maxLength: 120, description: "Session name" }),
      prompt: Type.String({ minLength: 1, maxLength: 100_000, description: "Complete initial prompt" }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, parameters) => {
      const result = await bridge.invoke(parameters)
      return {
        content: [{ type: "text" as const, text: `Started top-level Session ${result.sessionId} in Project ${result.projectId}` }],
        details: result,
      }
    },
  })]
}

export function createProjectTools(createProject: (input: { readonly name: string; readonly directory: string }) => Promise<Project>, delegated = false) {
  if (delegated) return []
  return [defineTool({
    name: "create_project",
    label: "Create Pi Station Project",
    description: "Add an existing directory as a Pi Station Project. This configures the Project but does not create or modify the directory.",
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200, description: "Project display name" }),
      directory: Type.String({ minLength: 1, maxLength: 4096, description: "Existing directory to use as the Project working directory" }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, parameters) => {
      const project = await createProject(parameters)
      return {
        content: [{ type: "text" as const, text: `Created Project ${project.name ?? parameters.name} (${project.id}) at ${project.root}` }],
        details: { project },
      }
    },
  })]
}

export function listProjectsTools(listProjects: () => Promise<readonly Project[]>, currentProjectId: string, delegated = false) {
  if (delegated) return []
  return [defineTool({
    name: "list_projects",
    label: "List Pi Station Projects",
    description: "List all Projects configured on this Pi Station host. This tool does not change any Project.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const projects = (await listProjects()).map((project) => ({
        id: project.id,
        name: project.name ?? project.root.split("/").at(-1) ?? project.root,
        workingDirectory: project.root,
        current: project.id === currentProjectId,
      })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      return {
        content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }],
        details: { projects },
      }
    },
  })]
}

export function moveSessionTools(bridge: SessionMoveAgentBridge, sessionId: string, projectId?: string, delegated = false) {
  if (projectId === undefined || delegated) return []
  return [defineTool({
    name: "move_session_to_project",
    label: "Move Session to Project",
    description: "Schedule this calling Session to move to another configured Pi Station Project after the complete current turn ends.",
    parameters: Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 200, description: "Exact configured Project ID" }) }, { additionalProperties: false }),
    execute: async (_toolCallId, parameters) => {
      const moved = await bridge.invoke({ sessionId, projectId: parameters.projectId })
      const text = moved.status === "unchanged"
        ? `Session is already in Project ${moved.projectName} (${moved.projectId}); no move is needed.`
        : `Session move is scheduled for Project ${moved.projectName} (${moved.projectId}). It will apply after this complete turn ends.`
      return { content: [{ type: "text", text }], details: moved }
    },
  })]
}

export function scheduledTools(bridge: ScheduledJobAgentBridge, projectId: string, sessionId: string) {
  const actor = `Pi Session ${sessionId}`
  const target = Type.Union([
    Type.Object({ type: Type.Literal("new-session") }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("existing-session"), sessionId: Type.String() }, { additionalProperties: false }),
  ])
  const schedule = Type.Union([
    Type.Object({ type: Type.Literal("one-time"), localDateTime: Type.String({ description: "Local date and time in YYYY-MM-DDTHH:mm format. Pi Station applies its global timezone." }) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("recurring"), frequency: Type.Literal("interval"), interval: Type.Integer({ minimum: 1, maximum: 1_000_000 }), intervalUnit: Type.Union([Type.Literal("minute"), Type.Literal("hour"), Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")]), localStart: Type.Optional(Type.String()) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("recurring"), frequency: Type.Literal("daily"), localTime: Type.String({ pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }) }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("recurring"), frequency: Type.Literal("weekly"), weekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7, uniqueItems: true }), localTime: Type.String() }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("recurring"), frequency: Type.Literal("monthly"), day: Type.Integer({ minimum: 1, maximum: 31 }), localTime: Type.String() }, { additionalProperties: false }),
  ])
  const mutation = { title: Type.String({ minLength: 1, maxLength: 200 }), prompt: Type.String({ minLength: 1, maxLength: 100000 }), target, schedule }
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value })
  return [
    defineTool({ name: "list_scheduled_jobs", label: "List Scheduled Jobs", description: "List Scheduled Jobs owned by this Project. This tool does not change any job.", parameters: Type.Object({}, { additionalProperties: false }), execute: async () => result(await bridge.invoke("list", { projectId })) }),
    defineTool({ name: "get_scheduled_job", label: "Get Scheduled Job", description: "Get one Scheduled Job by its exact ID, including its bounded run history.", parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), execute: async (_id, input) => result(await bridge.invoke("get", input)) }),
    defineTool({ name: "create_scheduled_job", label: "Create Scheduled Job", description: "Create one Project-owned Scheduled Job. Do not supply a timezone; Pi Station applies its global timezone and snapshots it for recurring schedules.", parameters: Type.Object(mutation, { additionalProperties: false }), execute: async (_id, input) => result(await bridge.invoke("create", { projectId, mutation: { ...input, actor } })) }),
    defineTool({ name: "update_scheduled_job", label: "Update Scheduled Job", description: "Replace the title, Prompt, target, and schedule of one Scheduled Job. Omitted old values are not retained. Do not supply a timezone.", parameters: Type.Object({ id: Type.String(), ...mutation }, { additionalProperties: false }), execute: async (_id, input) => { const { id, ...values } = input; return result(await bridge.invoke("update", { id, projectId, mutation: { ...values, actor } })) } }),
    defineTool({ name: "pause_scheduled_job", label: "Pause Scheduled Job", description: "Pause one active Scheduled Job. A paused job does not start scheduled runs.", parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), execute: async (_id, input) => result(await bridge.invoke("pause", { ...input, actor })) }),
    defineTool({ name: "resume_scheduled_job", label: "Resume Scheduled Job", description: "Resume one paused Scheduled Job. Disabled jobs whose Project was removed cannot resume.", parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), execute: async (_id, input) => result(await bridge.invoke("resume", { ...input, actor })) }),
    defineTool({ name: "delete_scheduled_job", label: "Delete Scheduled Job", description: "Permanently delete one Scheduled Job and its run history. Use only when deletion is explicitly intended.", parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), execute: async (_id, input) => result(await bridge.invoke("delete", input)) }),
    defineTool({ name: "run_scheduled_job_now", label: "Run Scheduled Job now", description: "Request one immediate run without changing the saved schedule. A busy fixed Session gets one pending retry.", parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), execute: async (_id, input) => result(await bridge.invoke("run-now", input)) }),
  ]
}

export async function deliverDelegationReport(
  session: Pick<RuntimeSession, "sendCustomMessage">,
  toolCallId: string,
  report: { readonly status: DelegationReportStatus; readonly message: string },
): Promise<void> {
  await session.sendCustomMessage({
    customType: DELEGATION_REPORT_CUSTOM_TYPE,
    content: report.message,
    display: true,
    details: {
      kind: "delegation-report",
      toolCallId,
      toolName: DELEGATION_TOOL_NAME,
      status: report.status,
    },
  }, { triggerTurn: true, deliverAs: "followUp" })
}

async function sendInboundAgentMessage(
  session: Pick<RuntimeSession, "sendCustomMessage">,
  message: RuntimeAgentMessage,
  deliverAs?: "steer",
): Promise<void> {
  const sender = message.fromName === undefined
    ? `Session ${message.fromSessionId}`
    : `${message.fromName} (Session ${message.fromSessionId})`
  await session.sendCustomMessage({
    customType: "pi-station-agent-message",
    content: `Agent message from ${sender}:\n${message.message}`,
    display: true,
    details: {
      kind: "agent-message",
      fromSessionId: message.fromSessionId,
      ...(message.fromName === undefined ? {} : { fromName: message.fromName }),
      message: message.message,
    },
  }, {
    triggerTurn: true,
    ...(deliverAs === undefined ? {} : { deliverAs }),
  })
}

async function sendAgentMentionContext(
  session: Pick<RuntimeSession, "sendCustomMessage">,
  mentions: readonly RuntimeAgentMention[],
  deliverAs?: "steer" | "followUp",
): Promise<void> {
  await session.sendCustomMessage({
    customType: "pi-station-agent-mentions",
    content: [
      "Agent mention targets for the next user message:",
      ...mentions.map((mention) => `- @"${mention.label}" has Session ID "${mention.sessionId}".`),
      "Use send_agent_message with the Session ID when the user asks you to contact a mentioned agent.",
    ].join("\n"),
    display: false,
    details: { mentions },
  }, {
    triggerTurn: false,
    ...(deliverAs === undefined ? {} : { deliverAs }),
  })
}

function sdkImages(images: readonly RuntimePromptImage[]) {
  return images.map((image) => ({
    type: "image" as const,
    mimeType: image.mediaType,
    data: image.data,
  }))
}

class RuntimeLostError extends Error {
  constructor() { super("SDK runtime disconnected before the turn completed") }
}

function runtimeLifetime(): { readonly lost: Promise<never>; lose(): void } {
  let owned = true
  let rejectLost!: (error: Error) => void
  const lost = new Promise<never>((_resolve, reject) => { rejectLost = reject })
  // Prompt lifecycles observe explicit runtime ownership loss.
  void lost.catch(() => undefined)
  return {
    lost,
    lose() {
      if (!owned) return
      owned = false
      rejectLost(new RuntimeLostError())
    },
  }
}

function lastAssistantText(messages: readonly unknown[]): string | undefined {
  const message = [...messages].reverse().find((value) => {
    const item = asRecord(value)
    return item?.role === "assistant"
  })
  const content = asRecord(message)?.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((value): string[] => {
    const item = asRecord(value)
    return item?.type === "text" && typeof item.text === "string" ? [item.text] : []
  }).join("\n")
  return text === "" ? undefined : text
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function requiredSessionPath(input: { readonly sessionPath?: string }): string {
  if (input.sessionPath === undefined) throw new Error("Existing Session path is required")
  return input.sessionPath
}
