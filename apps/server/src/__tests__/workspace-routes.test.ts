import { mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime } from "../session-runtime.js"
import { createPiStationServer } from "../server.js"

const index: SessionIndex = {
  list: () => Promise.resolve([]), get: () => Promise.resolve(undefined), indexSession: (session) => Promise.resolve(session),
  refreshSession: () => Promise.resolve(undefined), timeline: () => Promise.resolve([]),
  historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
  timelineImage: () => Promise.resolve(undefined), rename: (session, name) => Promise.resolve({ ...session, name }),
}

async function request(base: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe("Workspace routes", () => {
  it("creates, updates, selects, persists, deletes, and removes deleted Projects", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-workspace-routes-"))
    const root1 = join(dataDir, "one"); const root2 = join(dataDir, "two")
    await mkdir(root1); await mkdir(root2)
    const runner = { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
    const server = createPiStationServer({ dataDir, index, runner })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address(); if (address === null || typeof address === "string") throw new Error("No address")
    const base = `http://127.0.0.1:${address.port}`
    try {
      const project1 = ((await request(base, "/v2/projects", "POST", { root: root1 })).body.projects as Array<{ id: string }>)[0]!
      const project2 = ((await request(base, "/v2/projects", "POST", { root: root2 })).body.projects as Array<{ id: string }>)[1]!
      const created = await request(base, "/v2/workspaces", "POST", { name: "Main" })
      expect(created.status).toBe(201)
      const id = (created.body.workspaces as Array<{ id: string }>)[0]!.id
      expect(created.body).toMatchObject({ version: 2, activeWorkspaceId: id, workspaces: [{ name: "Main", projectIds: [] }] })
      expect((await request(base, `/v2/workspaces/${id}`, "PUT", { projectIds: [project2.id, project1.id] })).body).toMatchObject({ workspaces: [{ name: "Main", projectIds: [project2.id, project1.id] }] })
      expect((await request(base, `/v2/workspaces/${id}`, "PUT", { name: "Renamed" })).body).toMatchObject({ workspaces: [{ name: "Renamed", projectIds: [project2.id, project1.id] }] })
      expect((await request(base, `/v2/workspaces/${id}/activate`, "POST", {})).body.activeWorkspaceId).toBe(id)
      await request(base, `/v2/projects/${project1.id}`, "DELETE")
      expect((await request(base, "/v2/workspaces")).body).toMatchObject({ activeWorkspaceId: id, workspaces: [{ projectIds: [project2.id] }] })
      expect((await request(base, `/v2/workspaces/${id}`, "PUT", { projectIds: ["missing"] })).status).toBe(400)
      expect((await request(base, `/v2/workspaces/${id}`, "DELETE")).body).toMatchObject({ workspaces: [] })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
