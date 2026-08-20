# Pi Station

Pi Station is a local Workspace UI for Pi. It uses the public Pi SDK directly. Pi owns Session files, history, model settings, and runtime metadata. Pi Station stores only its application metadata.

> [!WARNING]
> Pi Station is a new, pre-1.0 project. Expect defects, incomplete platform coverage, and breaking changes to installation, configuration, application metadata, and APIs. Back up important data before an update and review release notes before you install a new version.

## Production architecture

There is one production path:

- `apps/web/`: the only Workspace UI.
- `apps/server/`: the loopback HTTP server and SDK Session runtime.
- `packages/application-protocol/`: the normalized application contract. Stable HTTP endpoints remain under `/v2/**`.
- `~/.local/share/pi-station`: Pi Station application data.
- `~/.pi/agent/pi-station/shared`: Session shared files. This data is not moved by the application-data migration.
- `pi-station.service`: the only application service.

The retired broker, Pi process bridge, alternate RPC UI, and their protocols are not part of this architecture.

## Development

Use Node.js 22.19 or newer and npm 10 or newer.

```bash
npm install
npm run dev:server
npm run dev:workspace
```

For isolated work, use `npm run dev:isolated`. It uses port 8811 and `~/.local/share/pi-station-dev`. The Workspace uses `VITE_PI_STATION_API` when its API is on another origin.

## Build and validation

```bash
npm run build
npm run check
```

## Install a release on Linux

Pi Station release artifacts support Linux systems that have:

- Node.js 22.19 or newer;
- a systemd user manager;
- `curl`; and
- Pi configured for the same user.

Download the release archive and its `.sha256` file from the release page. Then verify and install it:

```bash
sha256sum --check pi-station-VERSION-linux-ARCH.tar.gz.sha256
mkdir pi-station-release
tar -xzf pi-station-VERSION-linux-ARCH.tar.gz -C pi-station-release
./pi-station-release/install.sh
```

The installer creates `pi-station.service` as a user service. It installs application files below `~/.local/share/pi-station/app`, stores application data in `~/.local/share/pi-station`, and stores shared Session files in `~/.pi/agent/pi-station/shared`. It binds the server to loopback and opens the Workspace at `http://127.0.0.1:8801/workspace`.

Run the same installer from a newer release to update. The installer preserves the existing port, data directories, and public and local origins unless you supply replacement environment variables. It waits for active turns, changes the current release, restarts only Pi Station, checks service health, and confirms that Pi process IDs did not change. If validation fails, it restores the previous release and service configuration.

Configuration is in `~/.config/pi-station/environment`. View service logs with:

```bash
journalctl --user -u pi-station.service
```

To remove the service without removing Session or application data:

```bash
systemctl --user disable --now pi-station.service
rm ~/.config/systemd/user/pi-station.service
systemctl --user daemon-reload
```

## Install a release on macOS

Pi Station supports current macOS systems with Node.js 22.19 or newer and Pi configured for the same user. Download the macOS artifact for your architecture and verify it:

```bash
shasum -a 256 --check pi-station-VERSION-macos-ARCH.tar.gz.sha256
mkdir pi-station-release
tar -xzf pi-station-VERSION-macos-ARCH.tar.gz -C pi-station-release
./pi-station-release/install-macos.sh
```

The installer creates the `works.pistation.server` LaunchAgent. Application files and data are below `~/Library/Application Support/Pi Station`. Logs are in `~/Library/Logs/Pi Station`. The server binds to loopback at `http://127.0.0.1:8801`.

Run the installer from a newer release to update it. The installer preserves the existing port, data directories, and public and local origins unless you supply replacement environment variables. If validation fails, the installer restores the previous release and LaunchAgent configuration. To remove the LaunchAgent without removing Pi Station data:

```bash
launchctl bootout "gui/$UID/works.pistation.server"
rm ~/Library/LaunchAgents/works.pistation.server.plist
```

## Build a release artifact

Create a clean artifact and SHA-256 checksum for the current Linux or macOS architecture with:

```bash
npm run release:build -- 0.1.0
```

The files are written to `release/`. Building a release requires the normal development dependencies and `tar`. Linux uses `sha256sum`; macOS uses `shasum`. Build each architecture on its target operating system because production dependencies can contain native code. Publishing a release is a separate, explicit maintainer action.

## Local source deployment

On Linux with a systemd user manager, run `npm run deploy:local` from `master`. This command validates and builds the protocol, server, and Workspace; drains active turns; generates `pi-station.service` from the current checkout and environment; restarts only that service; and checks health and Pi process PIDs.

The deployment supports `PI_STATION_PORT`, `PI_STATION_DATA_DIR`, `PI_STATION_SHARED_ROOT`, `PI_STATION_WEB_ORIGIN`, and `PI_STATION_LOCAL_ORIGIN`. Push notifications also support an optional VAPID contact value in `PI_STATION_VAPID_SUBJECT`. Do not expose the service directly to the public internet.

Do not deploy from a feature worktree. Do not restart Pi processes.

## Data-name migration

The first new server start atomically renames the retired default `~/.local/share/pi-station-rpc-v2` to `~/.local/share/pi-station` only when the canonical directory does not exist. It never merges or replaces directories. A failed rename leaves the retired directory unchanged.

`PI_STATION_DATA_DIR` is canonical. `PI_STATION_RPC_V2_DATA_DIR` is accepted for one deployment boundary only and prints a retirement warning. Set the canonical variable before the next release. For rollback, point the previous release at the directory explicitly; do not copy, merge, or delete Session history.

## Open-source audit

`npm run check` starts with an audit that rejects known maintainer-specific paths, hostnames, addresses, and private runtime locations from tracked files. Run it before each public release.

## Security

The server binds to loopback. Do not expose it to the public internet. A connected client can ask Pi to use tools with the host user's authority.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you submit a change. Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not through a public issue.

## License

[MIT](LICENSE)
