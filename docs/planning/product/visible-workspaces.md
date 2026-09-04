# Visible Workspaces and Project groups

## Fixed design

Support two or three open Workspaces that remain visible. Restore Project grouping without restoring Project ownership. Do not change the composer, conversation view, theme, transparency, storage model, or runtime.

## Desktop layout

A persistent Workspace row sits above BOTH the sidebar and conversation. Keep it visible on Session, Project, library, and settings screens. The selected Workspace changes the whole working area.

```
[Pi Station · 2 working] [Client launch · 1 unread] [+] [Closed]
----------------------------------------------------------------
Project-grouped sidebar | Selected Session / other application page
```

Row height 44px. Workspace tabs 140–240px wide, one non-wrapping row, horizontal scrolling when needed. Keep the selected tab in view. Use existing theme colors. Mark selected tab with background and underline. Show all OPEN Workspaces as named tabs; no dropdown replacement. Plus creates and selects an empty Workspace. Closed opens restore list. Rename and Close belong in each tab's menu. Permanent Delete belongs only in closed list. Status counts include working and unread Sessions and their descendants, deduplicated by complete Session identity per Workspace. Do not invent approval/input state. Status must not reorder tabs. Follow Workspace collection order.

## Sidebar

Derive Project groups ONLY from explicit Workspace tabs. Show only Projects with tabs. Open one Session does not open all Project Sessions. Removing last tab removes empty group, not Project. Group order follows first Project occurrence in tabs; sessions preserve relative tab order. Never sort by activity/status. Keyboard navigation follows displayed visible order.

Configured Project name as heading; do not repeat Project label on each Session. Indent Session rows. Clear selected background. Parent Session contains collapsed delegated group, with child navigation available. Group collapse is view state only. Collapsed Project heading shows working/unread counts. Heading/disclosure toggles only; never navigates away. Group plus starts new-Session flow with Project selected. Open session opens global Session library and adds selected Session to current Workspace. Automatically expand group when selected Session changes via search/deep link. Keep collapse choices per Workspace in browser view state. Missing references remain removable with clear labels.

## Mobile

Workspace row remains visible with horizontal scrolling. Project-grouped sessions appear in existing navigation panel (or a minimal mobile drawer using the same navigation component). Do not require a menu to switch Workspace. Preserve ordering/status/lifecycle. Touch targets at least 44px. Prevent horizontal page overflow.

## Lifetime and guards

Switch restores selected tab. Collapse only hides rows. Remove tab removes reference. Close Workspace retains tabs. Close Session changes Session state. Stop agent interrupts execution. Never mix them.

Run unsaved-edit/attachment guard BEFORE selection or tab mutation. Cancel leaves state unchanged and resolves pending UI actions so controls do not get stuck. Workspace selection remains local to browser; do not create another state store. Use existing ApplicationClient methods. Pending create/session-open operations must not unexpectedly move another browser's selection.

## Agent ownership and component contracts

Agent A: new WorkspaceRow.tsx, WorkspaceRow.test.tsx, workspace-row.css only. Import CSS from component. Props: workspaces (protocol Workspace[]), activeWorkspaceId?: string, sessions (SessionSummary[]), onActivate(id):Promise<void>, onCreate(name):Promise<void>, onRename(id,name):Promise<void>, onClose(id):Promise<void>, onRestore(id):Promise<void>, onDelete(id):Promise<void>. Create callback owns creating AND selecting new Workspace; row does not guess the new ID from stale props. Restore callback owns restoring AND activating. Component handles async loading/errors and labelled dialogs. No dependency on WorkspaceSwitcher. Export helper workspaceActivity(workspace,sessions) if useful. Component tests cover overflow CSS structure, filtering closed, counts, actions, errors. No edits to Workspace.tsx/styles.css/client/server.

Agent B: WorkspaceNavigation.tsx, WorkspaceNavigation.test.tsx, workspace-navigation.css (new), optional helper/tests only. Keep current props and add onNewSessionInProject(project:ProjectSummary):void. Own Project grouping/collapse/Session library. Use full SessionKey identity, configured Project labels, and existing DelegatedChildren. Keep .workspace-tab-open and data-session-identity/data-unread hooks for keyboard controls; number shortcuts follow visible rows. Existing group state is view-only; do not alter protocol. Coordinate CSS to override old rules locally. No Workspace.tsx/styles.css/client/server edits.

Agent C: Workspace.tsx, WorkspaceSwitcher.tsx if required, MobileNavigationMenu.tsx if required, styles.css, related existing tests; may edit main.tsx only if essential. Integrate WorkspaceRow above all application page branches; remove redundant old dropdown from sidebar. Keep sidebar Project groups. Wire create/restore/select/close/delete via guarded parent callbacks. Pass onNewSessionInProject using existing Project-specific creation flow. Ensure mobile has row plus accessible project-grouped panel. Coordinate with A/B exports as defined; temporary missing-module type errors allowed until integration, but final must pass. Do not use compatibility casts to hide type errors. No protocol/server/client changes without reporting reason.

Parent: integrate commits into workspace-task-model branch/worktree (existing PR #118), verify HTTPS preview, run check/build, review tests and UI. Child agents use their own dedicated worktrees and commit. Do not open separate PRs. NODE_ENV=production in harness: npm ci --include=dev --ignore-scripts if deps needed. Never test production. Parent performs integrated development instance QA; child tests must remain isolated.

## Acceptance

1. Three open Workspaces remain visible without menu.
2. Two same-Project Sessions under one heading, other Project separate.
3. Same Project in two Workspaces can contain different Sessions.
4. Switching restores Session and expands relevant Project.
5. Working/unread updates do not reorder navigation.
6. Closing Workspace keeps agents working.
7. Cancelling guard changes no selection; retry works.
8. Keyboard follows visible group/Session order, including collapsed groups.
9. Mobile switches Workspace without menu; Project groups reachable.
10. Selected state, status, actions, names and touch targets remain clear at 390, 768, 1440px.

Do not substitute dropdown, restore Project ownership, or make unrelated visual changes. Report conflicts before deviating.
