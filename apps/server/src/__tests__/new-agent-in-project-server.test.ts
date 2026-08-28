import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Project, SessionKey } from "@pi-station/application-protocol"
import type { IndexedSession, SessionIndex } from "../domain.js"
import { NewAgentInProjectBridge } from "../new-agent-in-project.js"
import { ProjectStore } from "../project-store.js"
import { createPiStationServer, shutdownPiStationServer } from "../server.js"
import type { SessionRuntime, StartRuntimeTurn } from "../session-runtime.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function index(): { sessionIndex: SessionIndex; refreshSession: ReturnType<typeof vi.fn<(key: SessionKey, project: Project) => Promise<IndexedSession>>> } {
  const sessions = new Map<string, IndexedSession>()
  const refreshSession = vi.fn((key: SessionKey, project: Project): Promise<IndexedSession> => {
    const session = {
      id: key.sessionId,
      projectId: key.projectId,
      path: join(project.root, `${key.sessionId}.jsonl`),
      name: "Same Project Agent",
      modifiedAt: new Date().toISOString(),
    }
    sessions.set(key.sessionId, session)
    return Promise.resolve(session)
  })
  const sessionIndex = {
    list: vi.fn(() => Promise.resolve([...sessions.values()])),
    get: vi.fn((key: SessionKey) => Promise.resolve(sessions.get(key.sessionId))),
    indexSession: vi.fn(),
    refreshSession,
    timeline: vi.fn(() => Promise.resolve([])),
    historyPage: vi.fn(() => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] })),
    rename: vi.fn(),
  } as unknown as SessionIndex
  return { sessionIndex, refreshSession }
}

function runtime() {
  const run = vi.fn((input: StartRuntimeTurn) => {
    void input
    return {
      completion: new Promise<never>(() => undefined),
      ownershipLost: new Promise<never>(() => undefined),
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      control: vi.fn(),
      interruptOwned: vi.fn(),
      dispose: vi.fn(),
    }
  })
  return { run, runner: { run, control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime }
}

describe("new agent in Project host bridge", () => {
  it("looks up the exact configured Project and starts a normal top-level turn at its root", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-new-agent-data-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-station-new-agent-project-"))
    roots.push(dataDir, projectRoot)
    const [project] = await new ProjectStore(dataDir).configure([projectRoot])
    if (project === undefined) throw new Error("Project was not configured")
    await new ProjectStore(dataDir).setClosed(project.id, true)
    const bridge = new NewAgentInProjectBridge()
    const { run, runner } = runtime()
    const { sessionIndex, refreshSession } = index()
    const initializeSession = vi.fn()
    const server = createPiStationServer({ dataDir, index: sessionIndex, runner, newAgentInProject: bridge, initializeSession })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

    const result = await bridge.invoke({ projectId: project.id, name: "Same Project Agent", prompt: "Start now" })

    expect(result.status).toBe("started")
    expect(result.projectId).toBe(project.id)
    expect((await new ProjectStore(dataDir).read())[0]?.closed).toBeUndefined()
    expect(typeof result.sessionId).toBe("string")
    expect(initializeSession).toHaveBeenCalledWith(project.root, result.sessionId, "Same Project Agent")
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      projectId: project.id,
      sessionId: result.sessionId,
      cwd: project.root,
      session: "existing",
      sessionPath: join(project.root, `${result.sessionId}.jsonl`),
      prompt: "Start now",
    })
    expect(refreshSession).toHaveBeenCalledWith(
      { projectId: project.id, sessionId: result.sessionId },
      project,
    )
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("No address")
    const response = await fetch(`http://127.0.0.1:${address.port}/v2/sessions`)
    const body = (await response.json()) as { sessions: Array<Record<string, unknown>> }
    expect(body.sessions).toContainEqual(expect.objectContaining({
      id: result.sessionId,
      projectId: project.id,
      name: "Same Project Agent",
      state: "open",
    }))
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty("parentSessionId")
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty("delegated")
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty("settings")
    await shutdownPiStationServer(server, 0)
  })

  it("rejects an unknown or unavailable exact Project ID before Session creation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-new-agent-data-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-station-new-agent-project-"))
    roots.push(dataDir)
    const [project] = await new ProjectStore(dataDir).configure([projectRoot])
    if (project === undefined) throw new Error("Project was not configured")
    const bridge = new NewAgentInProjectBridge()
    const { run, runner } = runtime()
    const server = createPiStationServer({ dataDir, index: index().sessionIndex, runner, newAgentInProject: bridge, initializeSession: vi.fn() })

    await expect(bridge.invoke({ projectId: "Project Name", name: "Agent", prompt: "Go" })).rejects.toThrow("Project not found")
    await rm(projectRoot, { recursive: true, force: true })
    await expect(bridge.invoke({ projectId: project.id, name: "Agent", prompt: "Go" })).rejects.toThrow("Project is unavailable")
    expect(run).not.toHaveBeenCalled()
    await shutdownPiStationServer(server, 0)
  })
})
