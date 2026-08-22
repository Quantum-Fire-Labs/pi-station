import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EDGE_VERSION_ASSET, GitHubReleaseVersions, PiStationUpdater, ServiceManagerUpdateLauncher, UpdateSettingsStore } from "../updater.js"

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-station-updater-")); roots.push(root); return root
}

describe("Pi Station updater", () => {
  it("persists only the strict update channel and reports immutable versions", async () => {
    const root = await temporaryDirectory()
    const settings = new UpdateSettingsStore(root)
    const versions = { latest: vi.fn().mockResolvedValue("0.1.1+abcdef0") }
    const launcher = { launch: vi.fn().mockResolvedValue(undefined) }
    const updater = new PiStationUpdater("0.1.1", settings, versions, launcher)

    await expect(updater.setChannel("edge")).resolves.toMatchObject({ channel: "edge", latestVersion: "0.1.1+abcdef0", updateAvailable: true })
    expect(JSON.parse(await readFile(join(root, "update-settings.json"), "utf8"))).toEqual({ channel: "edge" })
    await updater.requestUpdate()
    expect(launcher.launch).toHaveBeenCalledWith("edge")
  })

  it("uses the stable release tag and edge metadata asset", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v1.2.3", assets: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "edge", assets: [{ name: EDGE_VERSION_ASSET, browser_download_url: "https://downloads.example/version" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "1.2.4+abcdef0" }), { status: 200 }))
    const versions = new GitHubReleaseVersions(fetcher)

    await expect(versions.latest("stable")).resolves.toBe("1.2.3")
    await expect(versions.latest("edge")).resolves.toBe("1.2.4+abcdef0")
    expect(fetcher.mock.calls[0]?.[0]).toContain("/releases/latest")
  })

  it("handles an old edge release without metadata without guessing a version", async () => {
    const versions = new GitHubReleaseVersions(vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag_name: "edge", assets: [] }), { status: 200 })))
    await expect(versions.latest("edge")).rejects.toThrow("does not publish version metadata yet")
  })

  it("delegates macOS updates to a separate launchd job", async () => {
    const root = await temporaryDirectory()
    const bin = join(root, "bin")
    const invocation = join(root, "invocation")
    await mkdir(bin)
    const command = join(bin, "launchctl")
    await writeFile(command, `#!/bin/bash\nprintf '%s\\n' "$@" > '${invocation}'\n`)
    await chmod(command, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}:/usr/bin:/bin`
    try { await new ServiceManagerUpdateLauncher(root, "darwin").launch("stable") } finally { process.env.PATH = originalPath }

    const arguments_ = await readFile(invocation, "utf8")
    expect(arguments_).toContain("submit")
    expect(arguments_).toContain("pi-station-update-")
    expect(arguments_).toContain("run-update.sh")
    expect(arguments_).toContain("stable")
  })

  it.runIf(process.platform === "linux")("delegates Linux updates to a separate systemd user service", async () => {
    const root = await temporaryDirectory()
    const bin = join(root, "bin")
    const invocation = join(root, "invocation")
    const launcherEnvironment = join(root, "launcher-environment")
    await mkdir(bin)
    const command = join(bin, "systemd-run")
    await writeFile(command, `#!/bin/bash\nprintf '%s\\n' "$@" > '${invocation}'\nprintf '%s\\n%s\\n' "$XDG_RUNTIME_DIR" "$DBUS_SESSION_BUS_ADDRESS" > '${launcherEnvironment}'\n`)
    await chmod(command, 0o755)
    const originalPath = process.env.PATH
    const originalRuntimeDirectory = process.env.XDG_RUNTIME_DIR
    const originalBusAddress = process.env.DBUS_SESSION_BUS_ADDRESS
    process.env.PATH = `${bin}:/usr/bin:/bin`
    process.env.XDG_RUNTIME_DIR = "/run/user/test"
    process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/test/bus"
    try { await new ServiceManagerUpdateLauncher(root, "linux").launch("edge") } finally {
      process.env.PATH = originalPath
      if (originalRuntimeDirectory === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = originalRuntimeDirectory
      if (originalBusAddress === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS; else process.env.DBUS_SESSION_BUS_ADDRESS = originalBusAddress
    }

    const arguments_ = await readFile(invocation, "utf8")
    expect(arguments_).toContain("--service-type=exec")
    expect(arguments_).toContain("run-update.sh")
    expect(arguments_).toContain("edge")
    expect(await readFile(launcherEnvironment, "utf8")).toBe("/run/user/test\nunix:path=/run/user/test/bus\n")
    const script = await readFile(join(root, "updater", "run-update.sh"), "utf8")
    expect(script).toContain("PI_STATION_CHANNEL=\"$channel\"")
    expect(script).not.toContain("auth.json")
  })
})
