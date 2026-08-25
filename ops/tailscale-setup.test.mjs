import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const roots = []
const executable = (path, content) => { writeFileSync(path, content); chmodSync(path, 0o755) }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(serveStatus = "{}") {
  const root = mkdtempSync(resolve(tmpdir(), "pi-station-tailscale-test-")); roots.push(root)
  const bin = resolve(root, "bin")
  const config = resolve(root, "environment")
  const calls = resolve(root, "calls")
  mkdirSync(bin, { recursive: true })
  writeFileSync(config, 'PI_STATION_PORT="18801"\nPI_STATION_LOCAL_ORIGIN="http://127.0.0.1:18801"\nPI_STATION_WEB_ORIGIN="http://127.0.0.1:18801"\n')
  executable(resolve(bin, "systemctl"), `#!/bin/bash\nprintf 'systemctl %s\\n' "$*" >> '${calls}'\nexit 0\n`)
  executable(resolve(bin, "tailscale"), `#!/bin/bash\nprintf 'tailscale %s\\n' "$*" >> '${calls}'\nif [[ $1 == status && $2 == --json ]]; then printf '%s' '{"BackendState":"Running","Self":{"DNSName":"station.example.ts.net."}}'; exit 0; fi
if [[ $1 == serve && $2 == status ]]; then printf '%s' '${serveStatus}'; exit 0; fi
exit 0
`)
  executable(resolve(bin, "curl"), `#!/bin/bash\nprintf 'curl %s\\n' "$*" >> '${calls}'\nif [[ $* == *healthz* ]]; then printf '{"status":"ok","activeTurns":0}'; fi
exit 0
`)
  executable(resolve(bin, "sleep"), "#!/bin/bash\nexit 0\n")
  return { root, bin, config, calls }
}

function run(value) {
  return spawnSync(resolve(import.meta.dirname, "../setup-tailscale.sh"), [], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${value.bin}:${resolve(process.execPath, "..")}:/usr/bin:/bin`,
      PI_STATION_ENVIRONMENT_FILE: value.config,
      PI_STATION_TAILSCALE_REMOTE_ATTEMPTS: "2",
    },
  })
}

describe("Tailscale setup", () => {
  it("keeps Pi Station on loopback and configures tailnet-only HTTPS", () => {
    const value = fixture()
    const result = run(value)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("https://station.example.ts.net/workspace")
    expect(readFileSync(value.config, "utf8")).toBe('PI_STATION_PORT="18801"\nPI_STATION_LOCAL_ORIGIN="http://127.0.0.1:18801"\nPI_STATION_WEB_ORIGIN="https://station.example.ts.net"\n')
    const calls = readFileSync(value.calls, "utf8")
    expect(calls).toContain("tailscale serve --bg --yes --https=443 http://127.0.0.1:18801")
    expect(calls).toContain("systemctl --user restart pi-station.service")
    expect(calls).not.toContain("funnel")
  })

  it("restores the prior origin and Serve configuration when remote validation fails", () => {
    const value = fixture()
    const originalEnvironment = readFileSync(value.config, "utf8")
    executable(resolve(value.bin, "curl"), `#!/bin/bash\nprintf 'curl %s\\n' "$*" >> '${value.calls}'\nif [[ $* == http://127.0.0.1:*healthz* ]]; then printf '{"status":"ok","activeTurns":0}'; exit 0; fi\nif [[ $* == https://* ]]; then exit 22; fi\nexit 0\n`)
    const result = run(value)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("restoring the previous Pi Station and Tailscale configuration")
    expect(readFileSync(value.config, "utf8")).toBe(originalEnvironment)
    expect(readFileSync(value.calls, "utf8")).toContain("tailscale serve --yes --https=443 off")
  })

  it("leaves a pre-existing matching route in place during rollback", () => {
    const value = fixture('{"TCP":{"443":{"HTTPS":true}},"Web":{"station.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:18801"}}}}}')
    executable(resolve(value.bin, "curl"), `#!/bin/bash\nprintf 'curl %s\\n' "$*" >> '${value.calls}'\nurl=\${!#}\nif [[ $url == http://127.0.0.1:*healthz* ]]; then printf '{"status":"ok","activeTurns":0}'; exit 0; fi\nif [[ $url == https://* ]]; then exit 22; fi\nexit 0\n`)
    const result = run(value)
    expect(result.status).not.toBe(0)
    expect(readFileSync(value.calls, "utf8")).not.toContain("tailscale serve --yes --https=443 off")
  })

  it("does not replace an unrelated HTTPS route", () => {
    const value = fixture('{"TCP":{"443":{"HTTPS":true}},"Web":{"station.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}')
    const result = run(value)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("HTTPS port 443 is already in use")
    expect(readFileSync(value.config, "utf8")).toContain('PI_STATION_WEB_ORIGIN="http://127.0.0.1:18801"')
  })
})
