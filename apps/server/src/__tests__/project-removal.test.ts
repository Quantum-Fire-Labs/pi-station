import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime } from "../session-runtime.js"
import { DelegationEvents, DelegationStore } from "../delegations.js"
import { createPiStationServer } from "../server.js"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Pi Station Project removal", () => {
  it("removes only Pi Station registration and metadata for a Project with closed Sessions", async () => {
    const test = await setup("closed")
    try {
      await writeFile(join(test.dataDir, "project-bookmarks.json"), JSON.stringify([test.projectId]))
      await writeFile(join(test.dataDir, "session-bookmarks.json"), JSON.stringify([{ projectId: test.projectId, sessionId: "session-1" }]))
      await writeFile(join(test.dataDir, "sessions.json"), JSON.stringify({ [`${test.projectId}:session-1`]: { state: "closed" } }))
      await writeFile(join(test.projectRoot, "preserved.txt"), "preserved")
      await writeFile(join(test.projectRoot, "session-1.jsonl"), "{\"type\":\"message\"}\n")

      const response = await fetch(`${test.base}/v2/projects/${test.projectId}`, { method: "DELETE" })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expect.objectContaining({ projects: [], bookmarks: [] }))
      expect(await readFile(join(test.projectRoot, "preserved.txt"), "utf8")).toBe("preserved")
      expect(await readFile(join(test.projectRoot, "session-1.jsonl"), "utf8")).toBe("{\"type\":\"message\"}\n")
      expect(JSON.parse(await readFile(join(test.dataDir, "sessions.json"), "utf8")) as unknown).toEqual({ "session-1": { state: "closed" } })
      expect(JSON.parse(await readFile(join(test.dataDir, "session-bookmarks.json"), "utf8")) as unknown).toEqual([{ sessionId: "session-1" }])
      expect(test.runner.dispose.mock.calls).toHaveLength(0)
    } finally {
      await test.close()
    }
  })

  it("disassociates a Project with an idle open Session without stopping Pi", async () => {
    const test = await setup("open")
    try {
      const response = await fetch(`${test.base}/v2/projects/${test.projectId}`, { method: "DELETE" })

      expect(response.status).toBe(200)
      expect((await (await fetch(`${test.base}/v2/projects`)).json() as { projects: unknown[] }).projects).toEqual([])
      expect((await (await fetch(`${test.base}/v2/sessions`)).json() as { sessions: unknown[] }).sessions).toEqual([])
      expect(test.runner.dispose.mock.calls).toHaveLength(0)
    } finally {
      await test.close()
    }
  })

  it("lets a working delegated Session finish after disassociation", async () => {
    const test = await setup("open")
    const record = {
      id: "delegation-1",
      projectId: test.projectId,
      parentSessionId: "parent-1",
      childSessionId: "session-1",
      childPath: join(test.projectRoot, "session-1.jsonl"),
      status: "working" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    try {
      test.delegationEvents.publish({ type: "started", record })
      test.delegationEvents.publishTurn({ type: "started", record })
      await vi.waitFor(async () => expect((await (await fetch(`${test.base}/healthz`)).json() as { activeTurns: number }).activeTurns).toBe(1))

      expect((await fetch(`${test.base}/v2/projects/${test.projectId}`, { method: "DELETE" })).status).toBe(200)
      expect((await (await fetch(`${test.base}/v2/sessions`)).json() as { sessions: unknown[] }).sessions).toEqual([])
      expect((await test.delegationStore.list()).find((item) => item.id === record.id)?.status).toBe("working")

      const completed = { ...record, status: "completed" as const, updatedAt: "2026-01-01T00:01:00.000Z" }
      test.delegationEvents.publish({ type: "completed", record: completed })
      test.delegationEvents.publishTurn({ type: "finished", record: completed })
      await vi.waitFor(async () => expect((await (await fetch(`${test.base}/healthz`)).json() as { activeTurns: number }).activeTurns).toBe(0))
      expect((await test.delegationStore.list()).find((item) => item.id === record.id)?.status).toBe("completed")
      expect(test.runner.dispose.mock.calls).toHaveLength(0)
    } finally {
      await test.close()
    }
  })

  it("rediscovers preserved Sessions when the same directory is added again", async () => {
    const test = await setup("open")
    try {
      expect((await fetch(`${test.base}/v2/projects/${test.projectId}`, { method: "DELETE" })).status).toBe(200)
      const added = await fetch(`${test.base}/v2/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: test.projectRoot }),
      })

      expect(added.status).toBe(201)
      expect((await added.json() as { projects: Array<{ id: string }> }).projects[0]?.id).toBe(test.projectId)
      expect((await (await fetch(`${test.base}/v2/sessions`)).json() as { sessions: Array<{ id: string }> }).sessions)
        .toContainEqual(expect.objectContaining({ id: "session-1", projectId: test.projectId }))
      expect(test.runner.dispose.mock.calls).toHaveLength(0)
    } finally {
      await test.close()
    }
  })
})

async function setup(state: "open" | "closed") {
  const dataDir = await mkdtemp(join(tmpdir(), "pi-station-project-removal-data-"))
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-station-project-removal-root-"))
  directories.push(dataDir, projectRoot)
  let projectId = ""
  const session = { id: "session-1", projectId, path: join(projectRoot, "session-1.jsonl"), modifiedAt: "2026-01-01T00:00:00.000Z" }
  const index: SessionIndex = {
    list: (projects) => Promise.resolve(projects.some((project) => project.id === projectId) ? [{ ...session, projectId }] : []),
    get: () => Promise.resolve(undefined),
    indexSession: (value) => Promise.resolve(value),
    refreshSession: (key) => Promise.resolve(key.projectId === projectId ? { ...session, projectId } : undefined),
    timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
    timelineImage: () => Promise.resolve(undefined),
    rename: (value, name) => Promise.resolve({ ...value, name }),
  }
  const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime & { dispose: ReturnType<typeof vi.fn> }
  const delegationEvents = new DelegationEvents()
  const delegationStore = new DelegationStore(dataDir)
  const server = createPiStationServer({ dataDir, index, runner, delegationEvents, delegationStore })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("No server address")
  const base = `http://127.0.0.1:${address.port}`
  const created = await fetch(`${base}/v2/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root: projectRoot }),
  })
  projectId = ((await created.json()) as { projects: Array<{ id: string }> }).projects[0]!.id
  await writeFile(join(dataDir, "sessions.json"), JSON.stringify({ [`${projectId}:session-1`]: { state } }))
  return {
    base,
    dataDir,
    projectId,
    projectRoot,
    runner,
    delegationEvents,
    delegationStore,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  }
}
