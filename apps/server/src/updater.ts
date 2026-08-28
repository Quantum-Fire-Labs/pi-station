import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import type { PiStationUpdateStatus, UpdateChannel } from "@pi-station/application-protocol"
import { isUpdateChannel } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

const SETTINGS_FILE = "update-settings.json"
const UPDATE_DIRECTORY = "updater"
const UPDATE_SCRIPT = "run-update.sh"
const RELEASE_API = "https://api.github.com/repos/Quantum-Fire-Labs/pi-station/releases"
export const RELEASE_BOOTSTRAP_URL = "https://raw.githubusercontent.com/Quantum-Fire-Labs/pi-station/master/install-release.sh"
export const EDGE_VERSION_ASSET = "pi-station-edge-version.json"
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u

interface StoredUpdateSettings { readonly channel: UpdateChannel }
interface GitHubAsset { readonly name: unknown; readonly browser_download_url: unknown }
interface GitHubRelease { readonly tag_name: unknown; readonly assets: unknown }

function isStoredUpdateSettings(value: unknown): value is StoredUpdateSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1
    && isUpdateChannel((value as { readonly channel?: unknown }).channel)
}

export class UpdateSettingsStore {
  readonly #store: AtomicJsonStore<StoredUpdateSettings>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, SETTINGS_FILE), isStoredUpdateSettings)
  }

  async read(): Promise<UpdateChannel> { return (await this.#store.read({ channel: "stable" })).channel }
  async replace(channel: UpdateChannel): Promise<UpdateChannel> { return (await this.#store.replace({ channel })).channel }
}

export interface ReleaseVersions {
  latest(channel: UpdateChannel): Promise<string>
}

export class GitHubReleaseVersions implements ReleaseVersions {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async latest(channel: UpdateChannel): Promise<string> {
    const release = await this.getJson<GitHubRelease>(channel === "stable" ? `${RELEASE_API}/latest` : `${RELEASE_API}/tags/edge`)
    if (channel === "stable") {
      if (typeof release.tag_name !== "string") throw new Error("The stable release has no version tag")
      const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : release.tag_name
      if (!VERSION_PATTERN.test(version)) throw new Error("The stable release version is invalid")
      return version
    }

    if (!Array.isArray(release.assets)) throw new Error("The edge release metadata is unavailable")
    const asset = (release.assets as GitHubAsset[]).find((candidate) => candidate.name === EDGE_VERSION_ASSET)
    if (asset === undefined || typeof asset.browser_download_url !== "string") {
      throw new Error("The existing edge release does not publish version metadata yet")
    }
    const metadata = await this.getJson<{ readonly version?: unknown }>(asset.browser_download_url)
    if (typeof metadata.version !== "string" || !VERSION_PATTERN.test(metadata.version)) throw new Error("The edge release version metadata is invalid")
    return metadata.version
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetcher(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "pi-station-updater" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
    return await response.json() as T
  }
}

export interface DetachedUpdateLauncher {
  launch(channel: UpdateChannel): Promise<void>
}

export class ServiceManagerUpdateLauncher implements DetachedUpdateLauncher {
  constructor(
    private readonly dataDir: string,
    private readonly operatingSystem = platform(),
    private readonly bootstrapUrl = RELEASE_BOOTSTRAP_URL,
  ) {}

  async launch(channel: UpdateChannel): Promise<void> {
    const directory = join(this.dataDir, UPDATE_DIRECTORY)
    const script = join(directory, UPDATE_SCRIPT)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(script, updateScript(), { mode: 0o700 })
    await chmod(script, 0o700)
    const label = `pi-station-update-${randomUUID()}`
    const arguments_ = [script, this.dataDir, this.bootstrapUrl, channel, process.execPath]
    if (this.operatingSystem === "linux") {
      await runLauncher("systemd-run", ["--user", "--quiet", "--collect", `--unit=${label}`, "--service-type=exec", "/bin/bash", ...arguments_])
      return
    }
    if (this.operatingSystem === "darwin") {
      await runLauncher("launchctl", ["submit", "-l", label, "--", "/bin/bash", ...arguments_])
      return
    }
    throw new Error("Updates are supported only on Linux and macOS")
  }
}

function runLauncher(command: string, arguments_: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...arguments_], {
      detached: true,
      stdio: "ignore",
      env: {
        HOME: homedir(),
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
        ...(process.env.XDG_RUNTIME_DIR === undefined ? {} : { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }),
        ...(process.env.DBUS_SESSION_BUS_ADDRESS === undefined ? {} : { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }),
      },
    })
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} could not start the update job`)))
    child.unref()
  })
}

function updateScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
data_dir=$1
bootstrap_url=$2
channel=$3
node_bin=$4
marker="$data_dir/maintenance.json"
cleanup() { rm -f -- "$marker"; }
trap cleanup EXIT
"$node_bin" -e 'const fs=require("node:fs"); fs.mkdirSync(process.argv[1],{recursive:true,mode:0o700}); fs.writeFileSync(process.argv[2],JSON.stringify({startedAt:new Date().toISOString(),pid:Number(process.argv[3])}),{mode:0o600})' "$data_dir" "$marker" "$$"
export PATH="$(dirname "$node_bin"):$PATH"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location "$bootstrap_url" | PI_STATION_CHANNEL="$channel" /bin/bash
`
}

export class PiStationUpdater {
  constructor(
    private readonly currentVersion: string,
    private readonly settings: UpdateSettingsStore,
    private readonly versions: ReleaseVersions,
    private readonly launcher: DetachedUpdateLauncher,
  ) {}

  async status(): Promise<PiStationUpdateStatus> {
    const channel = await this.settings.read()
    try {
      const latestVersion = await this.versions.latest(channel)
      return { channel, currentVersion: this.currentVersion, latestVersion, updateAvailable: latestVersion !== this.currentVersion }
    } catch (error) {
      return {
        channel,
        currentVersion: this.currentVersion,
        updateAvailable: false,
        latestVersionError: error instanceof Error ? error.message : "Could not check the latest release",
      }
    }
  }

  async setChannel(channel: UpdateChannel): Promise<PiStationUpdateStatus> {
    await this.settings.replace(channel)
    return this.status()
  }

  async requestUpdate(): Promise<void> {
    await this.launcher.launch(await this.settings.read())
  }
}

export async function readInstalledVersion(installationRoot: string, fallback: string): Promise<string> {
  try {
    const version = (await readFile(join(installationRoot, "VERSION"), "utf8")).trim()
    return VERSION_PATTERN.test(version) ? version : fallback
  } catch {
    return fallback
  }
}
