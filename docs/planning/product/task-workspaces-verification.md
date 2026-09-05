# Task workspaces: first delivery

## Scope

This delivery replaces Project-derived Workspace navigation with explicit Session tabs. It adds local Workspace selection, tab selection, Workspace close/restore, a Session library, visible agent status, and compact delegated-agent groups. Project configuration and Session execution remain independent from Workspace lifetime. Desktop transparency is unchanged.

File and preview tabs, a second pane, templates, and composer control changes remain in the next delivery. Mobile navigation retains the existing Dashboard and navigation menu; Workspace selection in that menu restores the selected tab.

## Automated checks

The integrated worktree passed:

- `npm run check`: open-source audit, type checks, ESLint, and 557 tests.
- `npm run build`: protocol, server, and web builds.
- `git diff --check`.

The test count includes 214 server tests, 288 web tests, 21 protocol tests, and 34 operations tests.

Regression coverage includes migration before Workspace reads, the empty legacy default, migration limits, duplicate tab order IDs, browser-local selection, closed Workspace fallback, explicit Session identity, keyboard tab navigation, and deep-link selection after tab creation.

## Functional checks

Checks used an isolated development instance from the integration worktree. Synthetic Sessions and a synthetic runtime were used. No real agent executed a test prompt. Production data and processes were not changed.

Passed in Chromium:

- Create a Workspace and activate its empty view.
- Open an existing Session in another Workspace.
- Switch back and restore the active tab and message text draft.
- Use Control+J to select the next tab.
- Remove a tab while a synthetic task runs; the Session remains open and working.
- Close a Workspace while a synthetic task runs; the Session remains open and working.
- Restore the closed Workspace and its draft.
- Use two independent browser contexts with different active Workspaces.
- Edit a sample Markdown file and cancel Workspace navigation; the editor text remains.
- Retry navigation after cancellation, then confirm discard; navigation completes.
- Read the Session screen and open Workspace navigation at a 390-pixel mobile viewport without horizontal overflow.

The Markdown editor check used browser-provided sample file responses. It verified the navigation guard, not a real file write.

## Migration and operation limits

Workspace metadata uses storage version 3. The HTTP protocol remains version 2. Legacy membership fields remain for compatibility, but do not define tab navigation. Migration includes open, top-level, non-quick Sessions and runs once. If a legacy Workspace needs more than 100 tabs, migration returns an error without writing version 3. No Session history is removed.

A tab close removes a reference only. Workspace close retains its tabs. Workspace deletion removes its metadata only. Session close and agent stop remain separate actions.
