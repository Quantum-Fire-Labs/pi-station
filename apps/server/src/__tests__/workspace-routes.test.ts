import { mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime } from "../session-runtime.js"
import { ProjectBookmarkStore } from "../project-bookmarks.js"
import { ProjectStore } from "../project-store.js"
import { createPiStationServer } from "../server.js"

const index: SessionIndex = {
  list: () => Promise.resolve([]), get: () => Promise.resolve(undefined), indexSession: (session) => Promise.resolve(session), refreshSession: () => Promise.resolve(undefined), timeline: () => Promise.resolve([]),
  historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }), timelineImage: () => Promise.resolve(undefined), rename: (session, name) => Promise.resolve({ ...session, name }),
}
async function request(base: string, path: string, method = "GET", body?: unknown) { const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() as Record<string, unknown> } }

describe("Workspace routes", () => {
  it("migrates legacy Project state through the first-start HTTP flow", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-workspace-migration-routes-"))
    const openRoot = join(dataDir, "open")
    const bookmarkedRoot = join(dataDir, "bookmarked")
    const archivedRoot = join(dataDir, "archived")
    await Promise.all([mkdir(openRoot), mkdir(bookmarkedRoot), mkdir(archivedRoot)])
    const projectStore = new ProjectStore(dataDir)
    const [openProject, bookmarkedProject, archivedProject] = await projectStore.configure([openRoot, bookmarkedRoot, archivedRoot])
    await projectStore.setClosed(bookmarkedProject!.id, true)
    await projectStore.setClosed(archivedProject!.id, true)
    await new ProjectBookmarkStore(dataDir).set(bookmarkedProject!.id, true, await projectStore.read())

    const server = createPiStationServer({ dataDir, index, runner: { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No address")
    try {
      const response = await request(`http://127.0.0.1:${address.port}`, "/v2/workspaces")
      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        workspaces: [{
          name: "Default",
          projectIds: [openProject!.id, bookmarkedProject!.id],
          closedProjectIds: [bookmarkedProject!.id],
          bookmarkedProjectIds: [bookmarkedProject!.id],
        }],
      })
      expect((response.body.workspaces as Array<{ projectIds: string[] }>)[0]?.projectIds).not.toContain(archivedProject!.id)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("does not preempt Session migration when Projects are requested first", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-workspace-project-first-")); const root = join(dataDir, "one"); await mkdir(root)
    const projectStore = new ProjectStore(dataDir); const project = (await projectStore.configure([root]))[0]!
    const migrationIndex: SessionIndex = { ...index, list: () => Promise.resolve([{ id: "session-1", projectId: project.id, path: join(dataDir, "session.jsonl"), modifiedAt: "2026-01-01T00:00:00.000Z" }]) }
    const server = createPiStationServer({ dataDir, index: migrationIndex, runner: { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No address"); const base = `http://127.0.0.1:${address.port}`
    try {
      expect((await request(base, "/v2/projects")).status).toBe(200)
      const state = (await request(base, "/v2/workspaces")).body
      expect(state).toMatchObject({ workspaces: [{ tabs: [{ projectId: project.id, sessionId: "session-1" }] }] })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it("manages shared Project membership through explicit Workspace APIs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-workspace-routes-")); const root1 = join(dataDir, "one"); const root2 = join(dataDir, "two"); await mkdir(root1); await mkdir(root2)
    const server = createPiStationServer({ dataDir, index, runner: { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No address"); const base = `http://127.0.0.1:${address.port}`
    try {
      const project1 = ((await request(base, "/v2/projects", "POST", { root: root1 })).body.projects as Array<{ id: string }>)[0]!
      const initial = await request(base, "/v2/workspaces"); const defaultId = initial.body.activeWorkspaceId as string
      const created = await request(base, "/v2/workspaces", "POST", { name: "Main" }); const mainId = (created.body.workspaces as Array<{ id: string }>)[1]!.id
      expect(created.body.createdWorkspaceId).toBe(mainId)
      await request(base, `/v2/workspaces/${mainId}/activate`, "POST", {})
      const project2 = ((await request(base, "/v2/projects", "POST", { root: root2 })).body.projects as Array<{ id: string }>)[1]!
      expect((await request(base, "/v2/projects")).body).toMatchObject({ projects: [{ id: project1.id }, { id: project2.id }] })
      expect((await request(base, `/v2/workspaces/${mainId}/projects/${project1.id}/open`, "POST", {})).status).toBe(200)
      await request(base, `/v2/projects/${project1.id}/close`, "POST", {})
      let state = (await request(base, "/v2/workspaces")).body
      expect(state).toMatchObject({ activeWorkspaceId: defaultId, workspaces: [{ id: defaultId, projectIds: [project1.id], closedProjectIds: [] }, { id: mainId, projectIds: [project1.id], closedProjectIds: [] }] })
      expect((await request(base, `/v2/projects/${project1.id}/workspace`, "POST", { workspaceId: mainId })).status).toBe(404)
      expect((await request(base, `/v2/workspaces/${mainId}/projects/${project1.id}`, "DELETE")).status).toBe(200)
      state = (await request(base, "/v2/workspaces")).body
      expect(state).toMatchObject({ workspaces: [{ id: defaultId, projectIds: [project1.id] }, { id: mainId, projectIds: [], closedProjectIds: [] }] })
      expect((await request(base, "/v2/projects")).body).toMatchObject({ projects: [{ id: project1.id }, { id: project2.id }] })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it("manages explicit Session tabs and Workspace lifecycle", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-workspace-tab-routes-")); const root = join(dataDir, "one"); await mkdir(root)
    const server = createPiStationServer({ dataDir, index, runner: { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No address"); const base = `http://127.0.0.1:${address.port}`
    try {
      const project = ((await request(base, "/v2/projects", "POST", { root })).body.projects as Array<{ id: string }>)[0]!
      const initial = await request(base, "/v2/workspaces"); const first = initial.body.activeWorkspaceId as string
      const second = ((await request(base, "/v2/workspaces", "POST", { name: "Second" })).body.workspaces as Array<{ id: string }>)[1]!.id
      const opened = await request(base, `/v2/workspaces/${second}/tabs`, "POST", { projectId: project.id, sessionId: "session-1" })
      expect(opened.status).toBe(200)
      const tab = (opened.body.workspaces as Array<{ id: string; tabs: Array<{ id: string }> }>)[1]!.tabs[0]!
      expect(((await request(base, `/v2/workspaces/${second}/tabs`, "POST", { projectId: project.id, sessionId: "session-1" })).body.workspaces as Array<{ tabs: unknown[] }>)[1]?.tabs).toHaveLength(1)
      expect((await request(base, `/v2/workspaces/${second}/tabs/${tab.id}/activate`, "POST", {})).status).toBe(200)
      expect((await request(base, `/v2/workspaces/${second}/close`, "POST", {})).status).toBe(200)
      expect((await request(base, `/v2/workspaces/${second}/restore`, "POST", {})).status).toBe(200)
      expect((await request(base, `/v2/workspaces/${second}/tabs/${tab.id}`, "DELETE")).status).toBe(200)
      expect((await request(base, `/v2/workspaces/${second}`, "DELETE")).body).toMatchObject({ activeWorkspaceId: first })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
