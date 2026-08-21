import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const roots = []
const executable = (path, content) => { writeFileSync(path, content); chmodSync(path, 0o755) }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe("release bootstrap installer", () => {
  it.runIf(process.platform === "linux")("selects, verifies, and runs the latest release for the host", () => {
    const root = mkdtempSync(resolve(tmpdir(), "pi-station-bootstrap-")); roots.push(root)
    const bin = resolve(root, "bin")
    const marker = resolve(root, "installed")
    const fixture = resolve(root, "release.json")
    mkdirSync(bin, { recursive: true })
    writeFileSync(fixture, JSON.stringify({ assets: [
      { name: "pi-station-0.1.0-linux-x64.tar.gz", browser_download_url: "https://downloads.example/archive" },
      { name: "pi-station-0.1.0-linux-x64.tar.gz.sha256", browser_download_url: "https://downloads.example/checksum" },
      { name: "pi-station-0.1.0-macos-arm64.tar.gz", browser_download_url: "https://downloads.example/other" },
    ] }))
    executable(resolve(bin, "uname"), "#!/bin/bash\nif [[ $1 == -s ]]; then echo Linux; else echo x86_64; fi\n")
    executable(resolve(bin, "curl"), `#!/bin/bash\noutput=\nprevious=\nfor argument in "$@"; do if [[ $previous == --output ]]; then output=$argument; fi; previous=$argument; done\nurl=\${!#}\nif [[ $url == *api.github.com* ]]; then cat '${fixture}'; elif [[ $url == */archive ]]; then printf archive > "$output"; elif [[ $url == */checksum ]]; then printf checksum > "$output"; else exit 22; fi\n`)
    executable(resolve(bin, "sha256sum"), "#!/bin/bash\nexit 0\n")
    executable(resolve(bin, "tar"), `#!/bin/bash\ndestination=\nprevious=\nfor argument in "$@"; do if [[ $previous == -C ]]; then destination=$argument; fi; previous=$argument; done\nprintf '#!/bin/bash\\nprintf installed > "${marker}"\\n' > "$destination/install.sh"\nchmod +x "$destination/install.sh"\n`)

    const result = spawnSync(resolve(import.meta.dirname, "../install-release.sh"), [], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${resolve(process.execPath, "..")}:/usr/bin:/bin` },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("Downloading pi-station-0.1.0-linux-x64.tar.gz")
    expect(readFileSync(marker, "utf8")).toBe("installed")
  })

  it.runIf(process.platform === "linux")("selects the moving edge release when requested", () => {
    const root = mkdtempSync(resolve(tmpdir(), "pi-station-bootstrap-edge-")); roots.push(root)
    const bin = resolve(root, "bin")
    const requestedUrl = resolve(root, "requested-url")
    mkdirSync(bin, { recursive: true })
    executable(resolve(bin, "uname"), "#!/bin/bash\nif [[ $1 == -s ]]; then echo Linux; else echo x86_64; fi\n")
    executable(resolve(bin, "curl"), `#!/bin/bash\nprintf '%s' "\${!#}" > '${requestedUrl}'\nprintf '{"assets":[]}'\n`)
    executable(resolve(bin, "sha256sum"), "#!/bin/bash\nexit 0\n")
    const result = spawnSync(resolve(import.meta.dirname, "../install-release.sh"), [], {
      encoding: "utf8",
      env: { ...process.env, PI_STATION_CHANNEL: "edge", PATH: `${bin}:${resolve(process.execPath, "..")}:/usr/bin:/bin` },
    })
    expect(result.status).not.toBe(0)
    expect(readFileSync(requestedUrl, "utf8").endsWith("/repos/Quantum-Fire-Labs/pi-station/releases/tags/edge")).toBe(true)
    expect(result.stdout).toContain("Finding the Pi Station edge release")
  })

  it.runIf(process.platform === "linux")("rejects an edge channel combined with an explicit version", () => {
    const result = spawnSync(resolve(import.meta.dirname, "../install-release.sh"), [], {
      encoding: "utf8",
      env: { ...process.env, PI_STATION_CHANNEL: "edge", PI_STATION_VERSION: "0.1.1", PATH: `${resolve(process.execPath, "..")}:/usr/bin:/bin` },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("PI_STATION_VERSION and PI_STATION_CHANNEL=edge cannot be used together")
  })

  it.runIf(process.platform === "linux")("fails clearly when the host architecture is unsupported", () => {
    const root = mkdtempSync(resolve(tmpdir(), "pi-station-bootstrap-")); roots.push(root)
    const bin = resolve(root, "bin")
    mkdirSync(bin, { recursive: true })
    executable(resolve(bin, "uname"), "#!/bin/bash\nif [[ $1 == -s ]]; then echo Linux; else echo riscv64; fi\n")
    const result = spawnSync(resolve(import.meta.dirname, "../install-release.sh"), [], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${resolve(process.execPath, "..")}:/usr/bin:/bin` },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("unsupported architecture: riscv64")
  })
})

describe("Linux release installer", () => {
  it.runIf(process.platform === "linux")("restores the previous release and service files when health validation fails", () => {
    const root = mkdtempSync(resolve(tmpdir(), "pi-station-installer-")); roots.push(root)
    const home = resolve(root, "home")
    const installRoot = resolve(root, "application files")
    const artifact = resolve(root, "artifact")
    const bin = resolve(root, "bin")
    const configRoot = resolve(root, "config files")
    const unitDir = resolve(configRoot, "systemd/user")
    const settingsDir = resolve(configRoot, "pi-station")
    const previous = resolve(installRoot, "0.1.0")
    for (const directory of [home, artifact, bin, unitDir, settingsDir, previous, resolve(artifact, "apps/server/dist"), resolve(artifact, "node_modules")]) mkdirSync(directory, { recursive: true })
    writeFileSync(resolve(artifact, "VERSION"), "0.2.0\n")
    writeFileSync(resolve(artifact, "apps/server/dist/cli.js"), "")
    writeFileSync(resolve(previous, "marker"), "previous")
    symlinkSync(previous, resolve(installRoot, "current"))
    const previousEnvironment = [
      'PI_STATION_PORT="19999"',
      `PI_STATION_DATA_DIR="${resolve(root, "saved data")}"`,
      `PI_STATION_SHARED_ROOT="${resolve(root, "saved shared files")}"`,
      'PI_STATION_WEB_ROOT="/old/web"',
      'PI_STATION_WEB_ORIGIN="https://station.example.test"',
      'PI_STATION_LOCAL_ORIGIN="http://127.0.0.1:19999"',
      "",
    ].join("\n")
    writeFileSync(resolve(settingsDir, "environment"), previousEnvironment)
    writeFileSync(resolve(unitDir, "pi-station.service"), "old service\n")
    execFileSync("cp", [resolve(import.meta.dirname, "../install.sh"), resolve(artifact, "install.sh")])
    chmodSync(resolve(artifact, "install.sh"), 0o755)
    symlinkSync(process.execPath, resolve(bin, "node"))
    executable(resolve(bin, "systemctl"), `#!/bin/bash\nif [[ $* == *is-active* ]]; then exit 0; fi\nif [[ $* == *"start pi-station.service"* ]]; then if [[ ! -f '${resolve(root, "generated.service")}' ]]; then cp '${resolve(unitDir, "pi-station.service")}' '${resolve(root, "generated.service")}'; cp '${resolve(settingsDir, "environment")}' '${resolve(root, "generated.environment")}'; fi; fi\nexit 0\n`)
    executable(resolve(bin, "curl"), `#!/bin/bash\nstate=${resolve(root, "curl-count")}\ncount=$(cat "$state" 2>/dev/null || echo 0)\necho $((count + 1)) > "$state"\nif (( count == 0 )); then printf '{"status":"ok","activeTurns":0}'; exit 0; fi\nexit 22\n`)
    executable(resolve(bin, "sleep"), "#!/bin/bash\nexit 0\n")

    const environment = { ...process.env }
    for (const key of ["PI_STATION_PORT", "PI_STATION_DATA_DIR", "PI_STATION_SHARED_ROOT", "PI_STATION_WEB_ORIGIN", "PI_STATION_LOCAL_ORIGIN"]) delete environment[key]
    const result = spawnSync(resolve(artifact, "install.sh"), [], {
      encoding: "utf8",
      env: {
        ...environment,
        HOME: home,
        XDG_CONFIG_HOME: configRoot,
        PI_STATION_INSTALL_ROOT: installRoot,
        PATH: `${bin}:/usr/bin:/bin`,
      },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("restoring the previous release")
    expect(readlinkSync(resolve(installRoot, "current"))).toBe(previous)
    expect(readFileSync(resolve(previous, "marker"), "utf8")).toBe("previous")
    expect(readFileSync(resolve(settingsDir, "environment"), "utf8")).toBe(previousEnvironment)
    expect(readFileSync(resolve(unitDir, "pi-station.service"), "utf8")).toBe("old service\n")
    const generatedService = readFileSync(resolve(root, "generated.service"), "utf8")
    expect(generatedService).toContain(`WorkingDirectory=${resolve(installRoot, "current").replaceAll(" ", "\\x20")}`)
    expect(generatedService).toContain(`EnvironmentFile=${resolve(configRoot, "pi-station/environment").replaceAll(" ", "\\x20")}`)
    const generatedEnvironment = readFileSync(resolve(root, "generated.environment"), "utf8")
    expect(generatedEnvironment).toContain('PI_STATION_PORT="19999"')
    expect(generatedEnvironment).toContain('PI_STATION_WEB_ORIGIN="https://station.example.test"')
    expect(generatedEnvironment).toContain(`PI_STATION_DATA_DIR="${resolve(root, "saved data").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    expect(() => readFileSync(resolve(installRoot, "0.2.0/VERSION"))).toThrow()
  })
})
