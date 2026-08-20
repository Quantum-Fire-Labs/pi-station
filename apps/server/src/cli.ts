import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { ModelRuntime } from "@earendil-works/pi-coding-agent"
import { AgentMessagingBridge } from "./agent-messaging.js"
import { DelegationEvents, DelegationStore } from "./delegations.js"
import { createSdkSessionRuntime } from "./session-runtime.js"
import { NewAgentInProjectBridge } from "./new-agent-in-project.js"
import { PublicSessionIndex } from "./domain.js"
import { LOCAL_ORIGIN, WEB_ORIGIN } from "./http.js"
import { normalizeSharedFileOrigin, SharedFileService } from "./shared-files.js"
import { ProjectStore } from "./project-store.js"
import { SessionDefaultsStore } from "./session-defaults.js"
import { SessionMetadataStore } from "./session-metadata.js"
import { createPiStationServer, listenLocal, shutdownPiStationServer } from "./server.js"
import { resolveDataDirectory } from "./data-directory.js"
import { ScheduledJobAgentBridge, ScheduledJobStore, SettingsStore } from "./scheduled-jobs.js"
import { SessionMoveAgentBridge } from "./session-moves.js"

const dataDirectory = resolveDataDirectory()
const dataDir = dataDirectory.path
if (dataDirectory.usedRetiredEnvironment) console.warn("PI_STATION_RPC_V2_DATA_DIR is retired; set PI_STATION_DATA_DIR before the next release")
if (dataDirectory.migratedRetiredDefault) console.log(`Migrated Pi Station data atomically to ${dataDir}`)
const webRoot = process.env.PI_STATION_WEB_ROOT
const sharedRoot = resolve(process.env.PI_STATION_SHARED_ROOT ?? join(homedir(), ".pi", "agent", "pi-station", "shared"))
const port = Number.parseInt(process.env.PI_STATION_PORT ?? "8801", 10)
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Pi Station port is invalid")
const delegationEvents = new DelegationEvents()
const agentMessaging = new AgentMessagingBridge()
const newAgentInProject = new NewAgentInProjectBridge()
const delegationStore = new DelegationStore(dataDir)
const sessionMetadata = new SessionMetadataStore(dataDir)
const sessionDefaults = new SessionDefaultsStore(dataDir)
const scheduledJobStore = new ScheduledJobStore(dataDir)
const projectStore = new ProjectStore(dataDir)
const settingsStore = new SettingsStore(dataDir)
const scheduledJobAgentBridge = new ScheduledJobAgentBridge()
const sessionMoves = new SessionMoveAgentBridge()
const modelRuntime = await ModelRuntime.create()
const sharedFiles = new SharedFileService(sharedRoot)
const sharedOrigins = {
  publicOrigin: normalizeSharedFileOrigin(WEB_ORIGIN),
  localOrigin: normalizeSharedFileOrigin(LOCAL_ORIGIN),
}
await sharedFiles.initialize()
const recoverDelegatedAgent = async (input: { projectId: string; parentSessionId: string; childSessionId: string }) => {
  const record = await delegationStore.directChild(input)
  if (record === undefined) throw new Error("Session is not a direct delegated child of this Session")
  if (record.status === "working") throw new Error("Working delegated agent cannot be recovered")
  if (record.status !== "failed" && record.status !== "cancelled" && record.status !== "interrupted") {
    throw new Error("Only a failed, cancelled, or interrupted delegated Session can be recovered")
  }
  return record
}
const closeDelegatedAgent = async (input: { projectId: string; parentSessionId: string; childSessionId: string }): Promise<void> => {
  const record = await delegationStore.directChild(input)
  if (record === undefined) throw new Error("Session is not a direct delegated child of this Session")
  if (record.status === "working") throw new Error("Working delegated agent must be cancelled before it can be closed")
  await sessionMetadata.set({ projectId: input.projectId, sessionId: input.childSessionId }, "closed")
  delegationEvents.publish({ type: "closed", record })
}
const server = createPiStationServer({
  dataDir,
  index: new PublicSessionIndex(dataDir),
  runner: createSdkSessionRuntime(undefined, {
    delegationEvents,
    closeDelegatedAgent,
    recoverDelegatedAgent,
    sessionDefaults: () => sessionDefaults.read(),
    modelRuntime,
    sharedFiles: { directory: sharedFiles.directory, origins: sharedOrigins },
    scheduledJobs: scheduledJobAgentBridge,
    agentMessaging,
    listProjects: () => projectStore.read(),
    sessionMoves,
    newAgentInProject,
  }),
  delegationStore,
  delegationEvents,
  sessionDefaults,
  sharedFiles,
  scheduledJobStore,
  settingsStore,
  scheduledJobAgentBridge,
  agentMessaging,
  sessionMoves,
  newAgentInProject,
  sessionDefaultModels: () => modelRuntime.getAvailableSnapshot().map((model) => ({
    provider: model.provider,
    modelId: model.id,
    ...(model.name === undefined ? {} : { displayName: model.name }),
  })),
  ...(webRoot === undefined ? {} : { webRoot: resolve(webRoot) }),
})
await listenLocal(server, port)
console.log(`Pi Station: http://127.0.0.1:${port} (local only; data: ${dataDir})`)

let shuttingDown = false
const shutdown = (): void => {
  if (shuttingDown) return
  shuttingDown = true
  const timeoutMs = Number.parseInt(process.env.PI_STATION_SHUTDOWN_TIMEOUT_MS ?? "60000", 10)
  void shutdownPiStationServer(server, Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 60_000)
    .then(() => { process.exitCode = 0 })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
process.once("SIGTERM", shutdown)
process.once("SIGINT", shutdown)
