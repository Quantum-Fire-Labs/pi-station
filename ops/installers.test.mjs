import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const roots = []
const executable = (path, content) => { writeFileSync(path, content); chmodSync(path, 0o755) }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

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
    writeFileSync(resolve(settingsDir, "environment"), "OLD_ENV=1\n")
    writeFileSync(resolve(unitDir, "pi-station.service"), "old service\n")
    execFileSync("cp", [resolve(import.meta.dirname, "../install.sh"), resolve(artifact, "install.sh")])
    chmodSync(resolve(artifact, "install.sh"), 0o755)
    symlinkSync(process.execPath, resolve(bin, "node"))
    executable(resolve(bin, "systemctl"), `#!/bin/bash\nif [[ $* == *is-active* ]]; then exit 0; fi\nif [[ $* == *"start pi-station.service"* ]]; then [[ -f '${resolve(root, "generated.service")}' ]] || cp '${resolve(unitDir, "pi-station.service")}' '${resolve(root, "generated.service")}'; fi\nexit 0\n`)
    executable(resolve(bin, "curl"), `#!/bin/bash\nstate=${resolve(root, "curl-count")}\ncount=$(cat "$state" 2>/dev/null || echo 0)\necho $((count + 1)) > "$state"\nif (( count == 0 )); then printf '{"status":"ok","activeTurns":0}'; exit 0; fi\nexit 22\n`)
    executable(resolve(bin, "sleep"), "#!/bin/bash\nexit 0\n")

    const result = spawnSync(resolve(artifact, "install.sh"), [], {
      encoding: "utf8",
      env: {
        ...process.env,
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
    expect(readFileSync(resolve(settingsDir, "environment"), "utf8")).toBe("OLD_ENV=1\n")
    expect(readFileSync(resolve(unitDir, "pi-station.service"), "utf8")).toBe("old service\n")
    const generatedService = readFileSync(resolve(root, "generated.service"), "utf8")
    expect(generatedService).toContain(`WorkingDirectory=${resolve(installRoot, "current").replaceAll(" ", "\\x20")}`)
    expect(generatedService).toContain(`EnvironmentFile=${resolve(configRoot, "pi-station/environment").replaceAll(" ", "\\x20")}`)
    expect(() => readFileSync(resolve(installRoot, "0.2.0/VERSION"))).toThrow()
  })
})
