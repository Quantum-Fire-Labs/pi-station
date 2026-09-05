# Task workspaces

## Goal

A Workspace contains open work. It does not own Projects or Session history. Keep the existing desktop transparency.

## First delivery

Replace project-derived navigation with explicit Session tabs. Restore the selected tab on return. Close and restore Workspaces without changing Session state or execution. Keep Projects and saved Sessions in a separate library. Show agent status and a global needs-attention list. Keep child agents grouped under their parent. Preserve drafts and unsaved editor checks.

## Shared contract

Use the application-protocol Workspace type as the source of truth:

```ts
interface WorkspaceSessionTab {
  readonly id: string;
  readonly kind: "session";
  readonly projectId: string;
  readonly sessionId: string;
}
interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly tabs: readonly WorkspaceSessionTab[];
  readonly activeTabId?: string;
  readonly closedAt?: string;
  // Transitional fields. Do not use these to derive new tab navigation.
  readonly projectIds: readonly string[];
  readonly closedProjectIds: readonly string[];
  readonly bookmarkedProjectIds: readonly string[];
}
```

WorkspaceState retains activeWorkspaceId as a compatibility/default hint only. Each browser stores its own active Workspace ID. The activate route must no longer change shared server selection. Workspace tab selection is saved on that specific Workspace; do not change other Workspaces.

Routes return the complete WorkspaceState:

- POST /v2/workspaces/:id/tabs with {projectId, sessionId}: add or select a Session tab; deduplicate by Session identity within that Workspace.
- PUT /v2/workspaces/:id/tabs with {tabIds}: reorder the complete tab list.
- DELETE /v2/workspaces/:id/tabs/:tabId: remove the tab reference only; select an adjacent tab when required.
- POST /v2/workspaces/:id/tabs/:tabId/activate with {}: save selected tab.
- POST /v2/workspaces/:id/close with {}: set closedAt.
- POST /v2/workspaces/:id/restore with {}: clear closedAt.
- DELETE /v2/workspaces/:id: delete Workspace metadata regardless of Project membership; retain the last open Workspace or create a blank default as needed.

Legacy Project membership migrates once to explicit tabs for currently open, non-quick, top-level Sessions in member Projects. Retain old fields during transition, but do not repopulate tabs after a user removes them. Never change Pi-owned Session files. Missing referenced Sessions must not crash navigation or silently launch an agent.

## Client API

Use these methods on ApplicationClient and its base:

- openSessionInWorkspace(workspaceId, projectId, sessionId)
- closeWorkspaceTab(workspaceId, tabId)
- selectWorkspaceTab(workspaceId, tabId)
- reorderWorkspaceTabs(workspaceId, tabIds)
- closeWorkspace(workspaceId)
- restoreWorkspace(workspaceId)

Existing activateWorkspace selects locally and restores the Workspace active tab. Session selection can continue through the existing selectSession path. UI opening an existing Session or creating a Session must add it to the selected Workspace. Switching tabs must not create a tab in a different Workspace by accident.

## Navigation sketch

```text
[Workspace name v]                            [Needs attention]
--------------------------------------------------------------
Open tabs                  | Selected Session
  Design       Pi Station  |
  Website copy Marketing   |
  Parent agent             |
    3 agents · 1 working   |
                           |
+ New Session              |
Open saved Session         |
--------------------------------------------------------------
Projects / Session library | Composer
Settings                   |
```

Workspace switcher separates open and closed Workspaces. Empty Workspaces offer New Session and Open existing Session. Templates are added only when supported; do not show inactive controls.

## Later delivery

Add file and preview tabs, one optional second pane, simpler composer controls, and templates after the first delivery passes tests. Terminal tabs require a separate process lifetime design. Never run agents or shell commands merely by applying a template.

## Verification

Use isolated data and development ports, never production. Test migration, two Workspaces with one Session, close while working, restoration, independent browser selection, drafts, delegated agents, keyboard use, and mobile navigation. Review migration and close/stop semantics independently. Leave the integrated development instance running for user review and open a pull request.
