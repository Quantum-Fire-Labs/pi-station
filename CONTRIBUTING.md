# Contributing to Pi Station

Thank you for helping improve Pi Station.

## Requirements

- Node.js 22.19 or newer
- npm 10 or newer
- Pi configured for the current user
- Git

Linux production installation requires a systemd user manager. macOS production installation uses a LaunchAgent.

## Development setup

```bash
git clone git@github.com:Quantum-Fire-Labs/pi-station.git
cd pi-station
npm install
npm run dev:server
npm run dev:workspace
```

Use `npm run dev:isolated` when you need a separate server, port, and data directory.

## Architecture

- `apps/web/` contains the Workspace UI.
- `apps/server/` contains the local HTTP server and Pi SDK runtime.
- `packages/application-protocol/` contains the versioned application contract.

Use public `@earendil-works/pi-coding-agent` APIs. Pi owns Session files, history, model settings, thinking settings, and runtime metadata. Pi Station owns only its application metadata.

Keep the `/v2/**` protocol strict and versioned. Do not add an alternate UI, broker, Pi process bridge, or parallel runtime.

## Product language

Use **Workspace**, **Dashboard**, **Bookmark**, **Project**, and **Session** in product text, documentation, and code comments. Do not use Star or Starred as synonyms for Bookmark or Bookmarked.

## Make a change

1. Create a focused branch.
2. Add or update tests for changed behavior.
3. Preserve existing workflows and data compatibility unless the change requires a documented break.
4. Do not migrate, delete, terminate, or restart Pi-owned Session data or processes in tests or development scripts.
5. Run the full validation command:

```bash
npm run check
```

6. Open a pull request that explains the problem, the solution, and the validation result.

Keep pull requests small when possible. Do not include generated release archives, credentials, local data, or machine-specific paths.

## Security reports

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## Releases

Maintainers create releases and publish artifacts. A contribution or merged pull request does not grant permission to publish packages or create releases.
