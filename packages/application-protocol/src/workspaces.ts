import { isProtocolId } from "./sessions.js"

export const MAX_WORKSPACES = 100
export const MAX_WORKSPACE_PROJECTS = 100

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly projectIds: readonly string[]
}

export interface WorkspaceState {
  readonly workspaces: readonly Workspace[]
  readonly activeWorkspaceId?: string
}

export interface WorkspaceCreateMutation {
  readonly name: string
}

export interface WorkspaceUpdateMutation {
  readonly name?: string
  readonly projectIds?: readonly string[]
}

export function isWorkspaceName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 120
    && value.trim() === value
    && [...value].every((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
}

export function isWorkspaceCreateMutation(value: unknown): value is WorkspaceCreateMutation {
  return isExactRecord(value, ["name"]) && Object.keys(value).length === 1 && isWorkspaceName(value.name)
}

export function isWorkspaceUpdateMutation(value: unknown): value is WorkspaceUpdateMutation {
  if (!isExactRecord(value, ["name", "projectIds"])) return false
  const keys = Object.keys(value)
  return keys.length > 0
    && (value.name === undefined || isWorkspaceName(value.name))
    && (value.projectIds === undefined || isProjectIds(value.projectIds))
}

export function isWorkspace(value: unknown): value is Workspace {
  if (!isExactRecord(value, ["id", "name", "projectIds"])) return false
  return typeof value.id === "string" && isProtocolId(value.id) && isWorkspaceName(value.name) && isProjectIds(value.projectIds)
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isExactRecord(value, ["workspaces", "activeWorkspaceId"]) || !Array.isArray(value.workspaces)) return false
  if (value.workspaces.length > MAX_WORKSPACES || !value.workspaces.every(isWorkspace)) return false
  const ids = value.workspaces.map(({ id }) => id)
  return new Set(ids).size === ids.length
    && (value.activeWorkspaceId === undefined || (typeof value.activeWorkspaceId === "string" && isProtocolId(value.activeWorkspaceId) && ids.includes(value.activeWorkspaceId)))
}

function isProjectIds(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= MAX_WORKSPACE_PROJECTS
    && value.every((id) => typeof id === "string" && isProtocolId(id))
    && new Set(value).size === value.length
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key))
}
