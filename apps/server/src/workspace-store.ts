import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { isWorkspaceState, MAX_WORKSPACES, type Project, type Workspace, type WorkspaceCreateMutation, type WorkspaceUpdateMutation, type WorkspaceState } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

interface StoredWorkspaceData extends WorkspaceState {
  readonly version: 1
}

const EMPTY: StoredWorkspaceData = { version: 1, workspaces: [] }

export class WorkspaceStoreError extends Error {
  constructor(readonly code: "not-found" | "invalid" | "limit", message: string) { super(message) }
}

export class WorkspaceStore {
  readonly #store: AtomicJsonStore<StoredWorkspaceData>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "workspaces.json"), isStoredWorkspaceData)
  }

  async list(): Promise<WorkspaceState> { return publicState(await this.#store.read(EMPTY)) }

  create(mutation: WorkspaceCreateMutation): Promise<WorkspaceState> {
    return this.#store.update(EMPTY, (current) => {
      if (current.workspaces.length >= MAX_WORKSPACES) throw new WorkspaceStoreError("limit", "A maximum of 100 Workspaces is allowed")
      const workspace: Workspace = { id: randomUUID(), name: mutation.name, projectIds: [] }
      return {
        version: 1,
        workspaces: [...current.workspaces, workspace],
        activeWorkspaceId: current.activeWorkspaceId ?? workspace.id,
      }
    }).then(publicState)
  }

  update(id: string, mutation: WorkspaceUpdateMutation, projects: readonly Project[]): Promise<WorkspaceState> {
    return this.#store.update(EMPTY, (current) => {
      if (!current.workspaces.some((workspace) => workspace.id === id)) throw new WorkspaceStoreError("not-found", "Workspace not found")
      if (mutation.projectIds !== undefined) validateProjects(mutation.projectIds, projects)
      return { ...current, workspaces: current.workspaces.map((workspace) => workspace.id === id ? { ...workspace, ...mutation } : workspace) }
    }).then(publicState)
  }

  remove(id: string): Promise<WorkspaceState> {
    return this.#store.update(EMPTY, (current) => {
      if (!current.workspaces.some((workspace) => workspace.id === id)) throw new WorkspaceStoreError("not-found", "Workspace not found")
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== id)
      const activeWorkspaceId = current.activeWorkspaceId === id ? workspaces[0]?.id : current.activeWorkspaceId
      return { version: 1, workspaces, ...(activeWorkspaceId === undefined ? {} : { activeWorkspaceId }) }
    }).then(publicState)
  }

  select(id: string | undefined): Promise<WorkspaceState> {
    return this.#store.update(EMPTY, (current) => {
      if (id !== undefined && !current.workspaces.some((workspace) => workspace.id === id)) throw new WorkspaceStoreError("not-found", "Workspace not found")
      return { version: 1, workspaces: current.workspaces, ...(id === undefined ? {} : { activeWorkspaceId: id }) }
    }).then(publicState)
  }

  removeProject(projectId: string): Promise<WorkspaceState> {
    return this.#store.update(EMPTY, (current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => ({ ...workspace, projectIds: workspace.projectIds.filter((id) => id !== projectId) })),
    })).then(publicState)
  }
}

function validateProjects(projectIds: readonly string[], projects: readonly Project[]): void {
  const configured = new Set(projects.map(({ id }) => id))
  if (projectIds.some((id) => !configured.has(id))) throw new WorkspaceStoreError("invalid", "Workspace contains an unknown Project")
}

function publicState({ workspaces, activeWorkspaceId }: StoredWorkspaceData): WorkspaceState {
  return { workspaces, ...(activeWorkspaceId === undefined ? {} : { activeWorkspaceId }) }
}

function isStoredWorkspaceData(value: unknown): value is StoredWorkspaceData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !["version", "workspaces", "activeWorkspaceId"].includes(key)) || record.version !== 1) return false
  return isWorkspaceState({ workspaces: record.workspaces, ...(record.activeWorkspaceId === undefined ? {} : { activeWorkspaceId: record.activeWorkspaceId }) })
}
