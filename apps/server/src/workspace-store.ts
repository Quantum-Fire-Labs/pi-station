import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { isWorkspaceState, MAX_WORKSPACE_PROJECTS, MAX_WORKSPACE_TABS, MAX_WORKSPACES, type Project, type SavedSession, type Workspace, type WorkspaceCreateMutation, type WorkspaceUpdateMutation, type WorkspaceState } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

interface StoredWorkspaceData extends WorkspaceState { readonly version: 3 }
interface V2Workspace { readonly id: string; readonly name: string; readonly projectIds: readonly string[]; readonly closedProjectIds: readonly string[]; readonly bookmarkedProjectIds: readonly string[] }
interface V2Data { readonly version: 2; readonly workspaces: readonly V2Workspace[]; readonly activeWorkspaceId: string }
interface LegacyWorkspace { readonly id: string; readonly name: string; readonly projectIds: readonly string[] }
interface LegacyData { readonly version: 1; readonly workspaces: readonly LegacyWorkspace[]; readonly activeWorkspaceId?: string }
type StoredData = StoredWorkspaceData | V2Data | LegacyData
const FALLBACK: StoredData = { version: 1, workspaces: [] }
const DEFAULT_NAME = "Default"

export class WorkspaceStoreError extends Error {
  constructor(readonly code: "not-found" | "invalid" | "limit" | "conflict", message: string) { super(message) }
}

export class WorkspaceStore {
  readonly #store: AtomicJsonStore<StoredData>
  constructor(dataDir: string) { this.#store = new AtomicJsonStore(join(dataDir, "workspaces.json"), isStoredData) }

  list(projects: readonly Project[], legacyBookmarks: readonly string[] = [], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> { return this.#update(projects, legacyBookmarks, sessions, (value) => value) }
  create(mutation: WorkspaceCreateMutation, projects: readonly Project[], legacyBookmarks: readonly string[] = [], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, legacyBookmarks, sessions, (current) => {
      if (current.workspaces.length >= MAX_WORKSPACES) throw new WorkspaceStoreError("limit", "A maximum of 100 Workspaces is allowed")
      return { ...current, workspaces: [...current.workspaces, emptyWorkspace(mutation.name)] }
    })
  }
  update(id: string, mutation: WorkspaceUpdateMutation, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => mapWorkspace(current, id, (workspace) => ({ ...workspace, name: mutation.name })))
  }
  remove(id: string, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => {
      requireWorkspace(current, id)
      let workspaces = current.workspaces.filter((workspace) => workspace.id !== id)
      if (!workspaces.some((workspace) => workspace.closedAt === undefined)) workspaces = [...workspaces, emptyWorkspace(DEFAULT_NAME)]
      const activeWorkspaceId = current.activeWorkspaceId === id ? workspaces.find((workspace) => workspace.closedAt === undefined)!.id : current.activeWorkspaceId
      return { ...current, workspaces, activeWorkspaceId }
    })
  }
  /** Validate browser selection without changing the shared compatibility hint. */
  select(id: string, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => { requireWorkspace(current, id); return current })
  }
  openSession(workspaceId: string, projectId: string, sessionId: string, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => mapWorkspace(current, workspaceId, (workspace) => {
      const existing = workspace.tabs.find((tab) => tab.projectId === projectId && tab.sessionId === sessionId)
      if (existing !== undefined) return { ...workspace, activeTabId: existing.id }
      if (workspace.tabs.length >= MAX_WORKSPACE_TABS) throw new WorkspaceStoreError("limit", "A maximum of 100 tabs per Workspace is allowed")
      const tab = { id: randomUUID(), kind: "session" as const, projectId, sessionId }
      return { ...workspace, tabs: [...workspace.tabs, tab], activeTabId: tab.id }
    }))
  }
  closeTab(workspaceId: string, tabId: string, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => mapWorkspace(current, workspaceId, (workspace) => {
      const index = workspace.tabs.findIndex(({ id }) => id === tabId)
      if (index < 0) throw new WorkspaceStoreError("not-found", "Workspace tab not found")
      const tabs = workspace.tabs.filter(({ id }) => id !== tabId)
      const activeTabId = workspace.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id : workspace.activeTabId
      const { activeTabId: ignored, ...withoutActiveTab } = workspace
      void ignored
      return { ...withoutActiveTab, tabs, ...(activeTabId === undefined ? {} : { activeTabId }) }
    }))
  }
  selectTab(workspaceId: string, tabId: string, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => mapWorkspace(current, workspaceId, (workspace) => {
      if (!workspace.tabs.some(({ id }) => id === tabId)) throw new WorkspaceStoreError("not-found", "Workspace tab not found")
      return { ...workspace, activeTabId: tabId }
    }))
  }
  reorderTabs(workspaceId: string, tabIds: readonly string[], projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => mapWorkspace(current, workspaceId, (workspace) => {
      if (tabIds.length !== workspace.tabs.length || !tabIds.every((id) => workspace.tabs.some((tab) => tab.id === id))) throw new WorkspaceStoreError("invalid", "tabIds must contain every Workspace tab exactly once")
      const tabs = tabIds.map((id) => workspace.tabs.find((tab) => tab.id === id)!)
      return { ...workspace, tabs }
    }))
  }
  setWorkspaceClosed(id: string, closed: boolean, projects: readonly Project[], sessions: readonly SavedSession[] = []): Promise<WorkspaceState> {
    return this.#update(projects, [], sessions, (current) => {
      const workspace = requireWorkspace(current, id)
      if (closed && workspace.closedAt === undefined && current.workspaces.filter((item) => item.closedAt === undefined).length === 1) throw new WorkspaceStoreError("conflict", "The last open Workspace cannot be closed")
      return mapWorkspace(current, id, (value) => {
        if (closed) return { ...value, closedAt: value.closedAt ?? new Date().toISOString() }
        const { closedAt: ignored, ...restored } = value
        void ignored
        return restored
      })
    })
  }

  addProject(projectId: string, projects: readonly Project[]): Promise<WorkspaceState> { return this.#update(projects.filter(({ id }) => id !== projectId), [], [], (current) => addToWorkspace(current, current.activeWorkspaceId, projectId)) }
  openProject(workspaceId: string, projectId: string, projects: readonly Project[]): Promise<WorkspaceState> { return this.#update(projects, [], [], (current) => { requireProject(projects, projectId); return addToWorkspace(current, workspaceId, projectId) }) }
  removeWorkspaceProject(workspaceId: string, projectId: string, projects: readonly Project[]): Promise<WorkspaceState> { return this.#update(projects, [], [], (current) => { const workspace = requireWorkspace(current, workspaceId); if (!workspace.projectIds.includes(projectId)) throw new WorkspaceStoreError("not-found", "Project is not in this Workspace"); return mapWorkspace(current, workspaceId, (value) => removeFromWorkspace(value, projectId)) }) }
  setClosed(projectId: string, closed: boolean, projects: readonly Project[]): Promise<WorkspaceState> { return this.#projectUpdate(projectId, projects, (workspace) => ({ ...workspace, closedProjectIds: closed ? [...new Set([...workspace.closedProjectIds, projectId])] : workspace.closedProjectIds.filter((id) => id !== projectId) })) }
  ensureOpen(projectId: string, projects: readonly Project[]): Promise<WorkspaceState> { return this.#update(projects, [], [], (current) => mapWorkspace(current, current.activeWorkspaceId, (workspace) => ({ ...workspace, closedProjectIds: workspace.closedProjectIds.filter((id) => id !== projectId) }))) }
  setBookmarked(projectId: string, bookmarked: boolean, projects: readonly Project[]): Promise<WorkspaceState> { return this.#projectUpdate(projectId, projects, (workspace) => ({ ...workspace, bookmarkedProjectIds: bookmarked ? [...new Set([...workspace.bookmarkedProjectIds, projectId])] : workspace.bookmarkedProjectIds.filter((id) => id !== projectId) })) }
  reorderBookmark(projectId: string, direction: "up" | "down", projects: readonly Project[]): Promise<WorkspaceState> { return this.#projectUpdate(projectId, projects, (workspace) => { const ids = [...workspace.bookmarkedProjectIds]; const index = ids.indexOf(projectId); const target = direction === "up" ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= ids.length) return workspace; [ids[index], ids[target]] = [ids[target]!, ids[index]!]; return { ...workspace, bookmarkedProjectIds: ids } }) }
  removeProject(projectId: string, projects: readonly Project[]): Promise<WorkspaceState> { return this.#update(projects, [], [], (current) => ({ ...current, workspaces: current.workspaces.map((workspace) => removeFromWorkspace(workspace, projectId)) })) }
  #projectUpdate(projectId: string, projects: readonly Project[], change: (workspace: Workspace) => Workspace): Promise<WorkspaceState> { return this.#update(projects, [], [], (current) => { requireProject(projects, projectId); const workspace = requireWorkspace(current, current.activeWorkspaceId); if (!workspace.projectIds.includes(projectId)) throw new WorkspaceStoreError("not-found", "Project is not in the active Workspace"); return mapWorkspace(current, workspace.id, change) }) }
  #update(projects: readonly Project[], bookmarks: readonly string[], sessions: readonly SavedSession[], change: (current: StoredWorkspaceData) => StoredWorkspaceData): Promise<WorkspaceState> { return this.#store.update(FALLBACK, (stored) => change(reconcile(stored, projects, bookmarks, sessions))).then((stored) => publicState(stored as StoredWorkspaceData)) }
}

function reconcile(stored: StoredData, projects: readonly Project[], bookmarks: readonly string[], sessions: readonly SavedSession[]): StoredWorkspaceData {
  const configured = new Set(projects.map(({ id }) => id))
  let source: readonly Workspace[]
  if (stored.version === 3) source = stored.workspaces
  else {
    const old = stored.workspaces.length === 0 ? [emptyWorkspace(DEFAULT_NAME)] : stored.workspaces.map((workspace) => ({ ...workspace, closedProjectIds: "closedProjectIds" in workspace ? workspace.closedProjectIds : [], bookmarkedProjectIds: "bookmarkedProjectIds" in workspace ? workspace.bookmarkedProjectIds : [], tabs: [] }))
    source = old.map((workspace) => {
      const tabs = sessions.filter((session) => session.state === "open" && session.quickSession !== true && session.parentSessionId === undefined && workspace.projectIds.includes(session.projectId)).map((session) => ({ id: randomUUID(), kind: "session" as const, projectId: session.projectId, sessionId: session.id }))
      return { ...workspace, tabs, ...(tabs[0] === undefined ? {} : { activeTabId: tabs[0].id }) }
    })
  }
  let workspaces = source.map((workspace) => { const projectIds = workspace.projectIds.filter((id) => configured.has(id)); const bookmarked = workspace.bookmarkedProjectIds.filter((id) => projectIds.includes(id)); return { ...workspace, projectIds, closedProjectIds: workspace.closedProjectIds.filter((id) => projectIds.includes(id)), bookmarkedProjectIds: [...bookmarked, ...bookmarks.filter((id) => projectIds.includes(id) && !bookmarked.includes(id))] } })
  if (stored.workspaces.length === 0) { const marked = new Set(bookmarks); const projectIds = projects.filter(({ id, closed }) => closed !== true || marked.has(id)).map(({ id }) => id); workspaces = [{ ...workspaces[0]!, projectIds, closedProjectIds: projects.filter(({ id, closed }) => closed === true && marked.has(id)).map(({ id }) => id), bookmarkedProjectIds: bookmarks.filter((id) => projectIds.includes(id)) }] }
  const activeWorkspaceId = stored.activeWorkspaceId !== undefined && workspaces.some(({ id }) => id === stored.activeWorkspaceId) ? stored.activeWorkspaceId : workspaces[0]!.id
  return { version: 3, workspaces, activeWorkspaceId }
}
function emptyWorkspace(name: string): Workspace { return { id: randomUUID(), name, tabs: [], projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] } }
function requireWorkspace(state: StoredWorkspaceData, id: string): Workspace { const value = state.workspaces.find((item) => item.id === id); if (!value) throw new WorkspaceStoreError("not-found", "Workspace not found"); return value }
function requireProject(projects: readonly Project[], id: string): void { if (!projects.some((project) => project.id === id)) throw new WorkspaceStoreError("not-found", "Project not found") }
function mapWorkspace(state: StoredWorkspaceData, id: string, change: (workspace: Workspace) => Workspace): StoredWorkspaceData { requireWorkspace(state, id); return { ...state, workspaces: state.workspaces.map((workspace) => workspace.id === id ? change(workspace) : workspace) } }
function addToWorkspace(state: StoredWorkspaceData, workspaceId: string, projectId: string): StoredWorkspaceData { const workspace = requireWorkspace(state, workspaceId); if (workspace.projectIds.includes(projectId)) return state; if (workspace.projectIds.length >= MAX_WORKSPACE_PROJECTS) throw new WorkspaceStoreError("limit", "A maximum of 100 Projects per Workspace is allowed"); return mapWorkspace(state, workspaceId, (value) => ({ ...value, projectIds: [...value.projectIds, projectId] })) }
function removeFromWorkspace(workspace: Workspace, id: string): Workspace { return { ...workspace, projectIds: workspace.projectIds.filter((item) => item !== id), closedProjectIds: workspace.closedProjectIds.filter((item) => item !== id), bookmarkedProjectIds: workspace.bookmarkedProjectIds.filter((item) => item !== id) } }
function publicState({ workspaces, activeWorkspaceId }: StoredWorkspaceData): WorkspaceState { return { workspaces, activeWorkspaceId } }
function isStoredData(value: unknown): value is StoredData { if (typeof value !== "object" || value === null || Array.isArray(value)) return false; const record = value as Record<string, unknown>; if (record.version === 3) return isWorkspaceState({ workspaces: record.workspaces, activeWorkspaceId: record.activeWorkspaceId }); if ((record.version !== 1 && record.version !== 2) || !Array.isArray(record.workspaces)) return false; return record.workspaces.every((item) => typeof item === "object" && item !== null && typeof (item as LegacyWorkspace).id === "string" && typeof (item as LegacyWorkspace).name === "string" && Array.isArray((item as LegacyWorkspace).projectIds)) }
