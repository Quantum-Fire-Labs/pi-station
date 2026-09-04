import { isProtocolId } from "./sessions.js"

export const MAX_WORKSPACES = 100
export const MAX_WORKSPACE_PROJECTS = 100
export const MAX_WORKSPACE_TABS = 100

export interface WorkspaceSessionTab {
  readonly id: string
  readonly kind: "session"
  readonly projectId: string
  readonly sessionId: string
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly tabs: readonly WorkspaceSessionTab[]
  readonly activeTabId?: string
  readonly closedAt?: string
  /** Transitional Project navigation data. */
  readonly projectIds: readonly string[]
  readonly closedProjectIds: readonly string[]
  readonly bookmarkedProjectIds: readonly string[]
}

export interface WorkspaceState {
  readonly workspaces: readonly Workspace[]
  /** Compatibility/default hint. Browser activation does not change this value. */
  readonly activeWorkspaceId: string
}

export interface WorkspaceCreateResult extends WorkspaceState {
  readonly createdWorkspaceId: string
}

export interface WorkspaceCreateMutation { readonly name: string }
export interface WorkspaceUpdateMutation { readonly name: string }
export interface WorkspaceOpenSessionMutation { readonly projectId: string; readonly sessionId: string }
export interface WorkspaceReorderTabsMutation { readonly tabIds: readonly string[] }

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

export function isWorkspaceOpenSessionMutation(value: unknown): value is WorkspaceOpenSessionMutation {
  return isExactRecord(value, ["projectId", "sessionId"]) && Object.keys(value).length === 2
    && typeof value.projectId === "string" && isProtocolId(value.projectId)
    && typeof value.sessionId === "string" && isProtocolId(value.sessionId)
}

export function isWorkspaceReorderTabsMutation(value: unknown): value is WorkspaceReorderTabsMutation {
  return isExactRecord(value, ["tabIds"]) && Object.keys(value).length === 1 && isIds(value.tabIds, MAX_WORKSPACE_TABS)
}

export function isWorkspaceSessionTab(value: unknown): value is WorkspaceSessionTab {
  return isExactRecord(value, ["id", "kind", "projectId", "sessionId"])
    && Object.keys(value).length === 4 && typeof value.id === "string" && isProtocolId(value.id)
    && value.kind === "session" && typeof value.projectId === "string" && isProtocolId(value.projectId)
    && typeof value.sessionId === "string" && isProtocolId(value.sessionId)
}

export function isWorkspace(value: unknown): value is Workspace {
  if (!isExactRecord(value, ["id", "name", "tabs", "activeTabId", "closedAt", "projectIds", "closedProjectIds", "bookmarkedProjectIds"])) return false
  if (typeof value.id !== "string" || !isProtocolId(value.id) || !isWorkspaceName(value.name)) return false
  if (!Array.isArray(value.tabs) || value.tabs.length > MAX_WORKSPACE_TABS || !value.tabs.every(isWorkspaceSessionTab)) return false
  const tabIds = value.tabs.map(({ id }) => id)
  const identities = value.tabs.map(({ projectId, sessionId }) => `${projectId}\0${sessionId}`)
  if (new Set(tabIds).size !== tabIds.length || new Set(identities).size !== identities.length) return false
  if (value.activeTabId !== undefined && (typeof value.activeTabId !== "string" || !tabIds.includes(value.activeTabId))) return false
  if (value.closedAt !== undefined && (typeof value.closedAt !== "string" || Number.isNaN(Date.parse(value.closedAt)))) return false
  if (!isIds(value.projectIds, MAX_WORKSPACE_PROJECTS) || !isIds(value.closedProjectIds, MAX_WORKSPACE_PROJECTS) || !isIds(value.bookmarkedProjectIds, MAX_WORKSPACE_PROJECTS)) return false
  const projects = new Set(value.projectIds)
  return value.closedProjectIds.every((id) => projects.has(id)) && value.bookmarkedProjectIds.every((id) => projects.has(id))
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isExactRecord(value, ["workspaces", "activeWorkspaceId"]) || !Array.isArray(value.workspaces)) return false
  if (value.workspaces.length === 0 || value.workspaces.length > MAX_WORKSPACES || !value.workspaces.every(isWorkspace)) return false
  const ids = value.workspaces.map(({ id }) => id)
  return new Set(ids).size === ids.length && typeof value.activeWorkspaceId === "string"
    && isProtocolId(value.activeWorkspaceId) && ids.includes(value.activeWorkspaceId)
}

function isIds(value: unknown, maximum: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximum
    && value.every((id) => typeof id === "string" && isProtocolId(id)) && new Set(value).size === value.length
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key))
}
