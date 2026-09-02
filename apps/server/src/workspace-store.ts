import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { isWorkspaceState, MAX_WORKSPACE_PROJECTS, MAX_WORKSPACES, type Project, type Workspace, type WorkspaceCreateMutation, type WorkspaceUpdateMutation, type WorkspaceState } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

interface StoredWorkspaceData extends WorkspaceState { readonly version: 2 }
interface LegacyWorkspace { readonly id: string; readonly name: string; readonly projectIds: readonly string[] }
interface LegacyData { readonly version: 1; readonly workspaces: readonly LegacyWorkspace[]; readonly activeWorkspaceId?: string }
type StoredData = StoredWorkspaceData | LegacyData
const FALLBACK: StoredData = { version: 1, workspaces: [] }
const DEFAULT_NAME = "Default"

export class WorkspaceStoreError extends Error {
  constructor(readonly code: "not-found" | "invalid" | "limit" | "conflict", message: string) { super(message) }
}

export class WorkspaceStore {
  readonly #store: AtomicJsonStore<StoredData>
  constructor(dataDir: string) { this.#store = new AtomicJsonStore(join(dataDir, "workspaces.json"), isStoredData) }

  list(projects: readonly Project[], legacyBookmarks: readonly string[] = []): Promise<WorkspaceState> {
    return this.#update(projects, legacyBookmarks, (current) => current)
  }

  create(mutation: WorkspaceCreateMutation, projects: readonly Project[], legacyBookmarks: readonly string[] = []): Promise<WorkspaceState> {
    return this.#update(projects, legacyBookmarks, (current) => {
      if (current.workspaces.length >= MAX_WORKSPACES) throw new WorkspaceStoreError("limit", "A maximum of 100 Workspaces is allowed")
      return { ...current, workspaces: [...current.workspaces, emptyWorkspace(mutation.name)] }
    })
  }

  update(id: string, mutation: WorkspaceUpdateMutation, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => {
      requireWorkspace(current, id)
      return { ...current, workspaces: current.workspaces.map((workspace) => workspace.id === id ? { ...workspace, name: mutation.name } : workspace) }
    })
  }

  remove(id: string, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => {
      const workspace = requireWorkspace(current, id)
      if (workspace.projectIds.length > 0) throw new WorkspaceStoreError("conflict", "Move all Projects before deleting this Workspace")
      if (current.workspaces.length === 1) throw new WorkspaceStoreError("conflict", "The default Workspace cannot be deleted")
      const workspaces = current.workspaces.filter((item) => item.id !== id)
      return { ...current, workspaces, activeWorkspaceId: current.activeWorkspaceId === id ? workspaces[0]!.id : current.activeWorkspaceId }
    })
  }

  select(id: string, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => { requireWorkspace(current, id); return { ...current, activeWorkspaceId: id } })
  }

  addProject(projectId: string, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects.filter((project) => project.id !== projectId), [], (current) => addToWorkspace(current, current.activeWorkspaceId, projectId))
  }

  openProject(workspaceId: string, projectId: string, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => {
      requireProject(projects, projectId)
      return addToWorkspace(current, workspaceId, projectId)
    })
  }

  removeWorkspaceProject(workspaceId: string, projectId: string, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => {
      requireProject(projects, projectId)
      const workspace = requireWorkspace(current, workspaceId)
      if (!workspace.projectIds.includes(projectId)) throw new WorkspaceStoreError("not-found", "Project is not in this Workspace")
      return mapWorkspace(current, workspaceId, (value) => removeFromWorkspace(value, projectId))
    })
  }

  setClosed(projectId: string, closed: boolean, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#projectUpdate(projectId, projects, (workspace) => ({ ...workspace, closedProjectIds: closed
      ? workspace.closedProjectIds.includes(projectId) ? workspace.closedProjectIds : [...workspace.closedProjectIds, projectId]
      : workspace.closedProjectIds.filter((id) => id !== projectId) }))
  }

  setBookmarked(projectId: string, bookmarked: boolean, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#projectUpdate(projectId, projects, (workspace) => ({ ...workspace, bookmarkedProjectIds: bookmarked
      ? workspace.bookmarkedProjectIds.includes(projectId) ? workspace.bookmarkedProjectIds : [...workspace.bookmarkedProjectIds, projectId]
      : workspace.bookmarkedProjectIds.filter((id) => id !== projectId) }))
  }

  reorderBookmark(projectId: string, direction: "up" | "down", projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#projectUpdate(projectId, projects, (workspace) => {
      const ids = [...workspace.bookmarkedProjectIds]; const index = ids.indexOf(projectId)
      const target = direction === "up" ? index - 1 : index + 1
      if (index < 0 || target < 0 || target >= ids.length) return workspace
      ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
      return { ...workspace, bookmarkedProjectIds: ids }
    })
  }

  removeProject(projectId: string, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => ({ ...current, workspaces: current.workspaces.map((workspace) => removeFromWorkspace(workspace, projectId)) }))
  }

  #projectUpdate(projectId: string, projects: readonly Project[], change: (workspace: Workspace) => Workspace): Promise<WorkspaceState> {
    return this.#update(projects, [], (current) => {
      requireProject(projects, projectId)
      const workspace = requireWorkspace(current, current.activeWorkspaceId)
      if (!workspace.projectIds.includes(projectId)) throw new WorkspaceStoreError("not-found", "Project is not in the active Workspace")
      return mapWorkspace(current, workspace.id, change)
    })
  }

  #update(projects: readonly Project[], legacyBookmarks: readonly string[], change: (current: StoredWorkspaceData) => StoredWorkspaceData): Promise<WorkspaceState> {
    return this.#store.update(FALLBACK, (stored) => change(reconcile(stored, projects, legacyBookmarks))).then((stored) => publicState(stored as StoredWorkspaceData))
  }
}

function reconcile(stored: StoredData, projects: readonly Project[], legacyBookmarks: readonly string[]): StoredWorkspaceData {
  const configured = new Set(projects.map(({ id }) => id))
  const source: readonly Workspace[] = stored.workspaces.length === 0
    ? [emptyWorkspace(DEFAULT_NAME)]
    : stored.version === 1
      ? stored.workspaces.map((workspace) => ({ ...workspace, closedProjectIds: [], bookmarkedProjectIds: [] }))
      : stored.workspaces
  const workspaces = source.map((workspace) => {
    const projectIds = workspace.projectIds.filter((id) => configured.has(id))
    const bookmarkedProjectIds = workspace.bookmarkedProjectIds.filter((id) => projectIds.includes(id))
    return { ...workspace, projectIds, closedProjectIds: workspace.closedProjectIds.filter((id) => projectIds.includes(id)), bookmarkedProjectIds: [...bookmarkedProjectIds, ...legacyBookmarks.filter((id) => projectIds.includes(id) && !bookmarkedProjectIds.includes(id))] }
  })
  const activeWorkspaceId = stored.activeWorkspaceId !== undefined && workspaces.some(({ id }) => id === stored.activeWorkspaceId)
    ? stored.activeWorkspaceId
    : workspaces[0]!.id
  const assigned = new Set(workspaces.flatMap(({ projectIds }) => projectIds))
  const missing = projects.filter(({ id }) => !assigned.has(id)).map(({ id }) => id)
  const active = workspaces.find(({ id }) => id === activeWorkspaceId)!
  const activeIndex = workspaces.indexOf(active)
  workspaces[activeIndex] = {
    ...active,
    projectIds: [...active.projectIds, ...missing],
    closedProjectIds: [...active.closedProjectIds, ...projects.filter(({ id, closed }) => missing.includes(id) && closed === true).map(({ id }) => id)],
    bookmarkedProjectIds: [...active.bookmarkedProjectIds, ...legacyBookmarks.filter((id) => missing.includes(id))],
  }
  return { version: 2, workspaces, activeWorkspaceId }
}

function emptyWorkspace(name: string): Workspace { return { id: randomUUID(), name, projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] } }
function requireWorkspace(state: StoredWorkspaceData, id: string): Workspace { const value = state.workspaces.find((item) => item.id === id); if (!value) throw new WorkspaceStoreError("not-found", "Workspace not found"); return value }
function requireProject(projects: readonly Project[], id: string): void { if (!projects.some((project) => project.id === id)) throw new WorkspaceStoreError("not-found", "Project not found") }
function mapWorkspace(state: StoredWorkspaceData, id: string, change: (workspace: Workspace) => Workspace): StoredWorkspaceData { return { ...state, workspaces: state.workspaces.map((workspace) => workspace.id === id ? change(workspace) : workspace) } }
function addToWorkspace(state: StoredWorkspaceData, workspaceId: string, projectId: string): StoredWorkspaceData {
  const workspace = requireWorkspace(state, workspaceId)
  if (workspace.projectIds.includes(projectId)) return state
  if (workspace.projectIds.length >= MAX_WORKSPACE_PROJECTS) throw new WorkspaceStoreError("limit", "A maximum of 100 Projects per Workspace is allowed")
  return mapWorkspace(state, workspaceId, (value) => ({ ...value, projectIds: [...value.projectIds, projectId] }))
}
function removeFromWorkspace(workspace: Workspace, id: string): Workspace { return { ...workspace, projectIds: workspace.projectIds.filter((item) => item !== id), closedProjectIds: workspace.closedProjectIds.filter((item) => item !== id), bookmarkedProjectIds: workspace.bookmarkedProjectIds.filter((item) => item !== id) } }
function publicState({ workspaces, activeWorkspaceId }: StoredWorkspaceData): WorkspaceState { return { workspaces, activeWorkspaceId } }
function isStoredData(value: unknown): value is StoredData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version === 2) return isWorkspaceState({ workspaces: record.workspaces, activeWorkspaceId: record.activeWorkspaceId })
  return record.version === 1 && Array.isArray(record.workspaces) && record.workspaces.every((workspace) => typeof workspace === "object" && workspace !== null && typeof (workspace as LegacyWorkspace).id === "string" && typeof (workspace as LegacyWorkspace).name === "string" && Array.isArray((workspace as LegacyWorkspace).projectIds))
}
