import { isProtocolId } from "./sessions.js"

export const MAX_WORKSPACES = 100
export const MAX_WORKSPACE_PROJECTS = 100

export interface Workspace {
  readonly id: string
  readonly name: string
  /** All Projects in this Workspace, in navigation order. */
  readonly projectIds: readonly string[]
  readonly closedProjectIds: readonly string[]
  /** Bookmarked Projects, in bookmark order. */
  readonly bookmarkedProjectIds: readonly string[]
  readonly lastSession?: WorkspaceSession
}

export interface WorkspaceSession { readonly projectId: string; readonly sessionId: string }

export interface WorkspaceState {
  readonly workspaces: readonly Workspace[]
  readonly activeWorkspaceId: string
}

export interface WorkspaceCreateMutation { readonly name: string }
export interface WorkspaceUpdateMutation { readonly name: string }
export interface WorkspaceSessionMutation { readonly projectId: string; readonly sessionId: string }

export function isWorkspaceName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && value.trim() === value
    && [...value].every((character) => { const code = character.charCodeAt(0); return code > 31 && code !== 127 })
}

export function isWorkspaceCreateMutation(value: unknown): value is WorkspaceCreateMutation {
  return isExactRecord(value, ["name"]) && Object.keys(value).length === 1 && isWorkspaceName(value.name)
}

export function isWorkspaceUpdateMutation(value: unknown): value is WorkspaceUpdateMutation {
  return isExactRecord(value, ["name"]) && Object.keys(value).length === 1 && isWorkspaceName(value.name)
}

export function isWorkspaceSessionMutation(value: unknown): value is WorkspaceSessionMutation {
  return isExactRecord(value, ["projectId", "sessionId"])
    && typeof value.projectId === "string" && isProtocolId(value.projectId)
    && typeof value.sessionId === "string" && isProtocolId(value.sessionId)
}

export function isWorkspace(value: unknown): value is Workspace {
  if (!isExactRecord(value, ["id", "name", "projectIds", "closedProjectIds", "bookmarkedProjectIds", "lastSession"])) return false
  if (typeof value.id !== "string" || !isProtocolId(value.id) || !isWorkspaceName(value.name)) return false
  if (!isProjectIds(value.projectIds) || !isProjectIds(value.closedProjectIds) || !isProjectIds(value.bookmarkedProjectIds)) return false
  const projects = new Set(value.projectIds)
  if (value.lastSession !== undefined && !isWorkspaceSessionMutation(value.lastSession)) return false
  return value.closedProjectIds.every((id) => projects.has(id)) && value.bookmarkedProjectIds.every((id) => projects.has(id))
    && (value.lastSession === undefined || projects.has(value.lastSession.projectId))
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isExactRecord(value, ["workspaces", "activeWorkspaceId"]) || !Array.isArray(value.workspaces)) return false
  if (value.workspaces.length === 0 || value.workspaces.length > MAX_WORKSPACES || !value.workspaces.every(isWorkspace)) return false
  const ids = value.workspaces.map(({ id }) => id)
  const projectIds = value.workspaces.flatMap((workspace) => workspace.projectIds)
  return new Set(ids).size === ids.length && new Set(projectIds).size === projectIds.length
    && typeof value.activeWorkspaceId === "string" && isProtocolId(value.activeWorkspaceId) && ids.includes(value.activeWorkspaceId)
}

function isProjectIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_WORKSPACE_PROJECTS
    && value.every((id) => typeof id === "string" && isProtocolId(id)) && new Set(value).size === value.length
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key))
}
