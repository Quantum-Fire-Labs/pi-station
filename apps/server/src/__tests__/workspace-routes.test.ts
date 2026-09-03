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

  it("moves exclusive Project ownership through explicit Workspace APIs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-workspace-routes-")); const root1 = join(dataDir, "one"); const root2 = join(dataDir, "two"); await mkdir(root1); await mkdir(root2)
    const server = createPiStationServer({ dataDir, index, runner: { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No address"); const base = `http://127.0.0.1:${address.port}`
    try {
      const project1 = ((await request(base, "/v2/projects", "POST", { root: root1 })).body.projects as Array<{ id: string }>)[0]!
      const initial = await request(base, "/v2/workspaces"); const defaultId = initial.body.activeWorkspaceId as string
      const created = await request(base, "/v2/workspaces", "POST", { name: "Main" }); const mainId = (created.body.workspaces as Array<{ id: string }>)[1]!.id
      await request(base, `/v2/workspaces/${mainId}/activate`, "POST", {})
      const project2 = ((await request(base, "/v2/projects", "POST", { root: root2 })).body.projects as Array<{ id: string }>)[1]!
      expect((await request(base, "/v2/projects")).body).toMatchObject({ projects: [{ id: project1.id }, { id: project2.id }] })
      expect((await request(base, `/v2/workspaces/${mainId}/projects/${project1.id}/open`, "POST", {})).status).toBe(200)
      const remembered = await fetch(`${base}/v2/workspaces/${mainId}/last-session`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project1.id, sessionId: "session-1" }) })
      expect(remembered.status).toBe(204)
      expect((await request(base, "/v2/workspaces")).body).toMatchObject({ workspaces: [{ id: defaultId }, { id: mainId, lastSession: { projectId: project1.id, sessionId: "session-1" } }] })
      await request(base, `/v2/projects/${project1.id}/close`, "POST", {})
      let state = (await request(base, "/v2/workspaces")).body
      expect(state).toMatchObject({ activeWorkspaceId: mainId, workspaces: [{ id: defaultId, projectIds: [] }, { id: mainId, projectIds: [project2.id, project1.id], closedProjectIds: [project1.id] }] })
      expect((await request(base, `/v2/projects/${project1.id}/workspace`, "POST", { workspaceId: mainId })).status).toBe(404)
      expect((await request(base, `/v2/workspaces/${mainId}/projects/${project1.id}`, "DELETE")).status).toBe(200)
      state = (await request(base, "/v2/workspaces")).body
      expect(state).toMatchObject({ workspaces: [{ id: defaultId, projectIds: [] }, { id: mainId, projectIds: [project2.id], closedProjectIds: [] }] })
      expect((await request(base, "/v2/projects")).body).toMatchObject({ projects: [{ id: project1.id }, { id: project2.id }] })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
