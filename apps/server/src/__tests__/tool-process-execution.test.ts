import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { isolateToolProcess, shellQuote } from "../tool-process-execution.js"

vi.mock("node:crypto", () => ({ randomUUID: () => "fixed-id" }))

describe("SDK tool process isolation", () => {
  it("assigns each bash call to an owned transient service outside the production cgroup", () => {
    const result = isolateToolProcess({ command: "npm run dev --host 127.0.0.1", cwd: "/workspace/project", env: { PI_SESSION_ID: "session-1" } }, "linux")

    expect(result.command).toContain("ops/tool-process-supervisor.sh")
    expect(result.command).toContain("pi-station-tool-")
    expect(result.command).toContain(shellQuote("npm run dev --host 127.0.0.1"))
    expect(result.cwd).toBe("/workspace/project")
    expect(result.env.PI_SESSION_ID).toBe("session-1")
    expect(result.env.PI_STATION_TOOL_UNIT).toMatch(/^pi-station-tool-\d+-fixed-id\.service$/u)
  })

  it("uses the descendant-owning supervisor on macOS", () => {
    const result = isolateToolProcess({ command: "npm test", cwd: "/workspace/project", env: { PI_SESSION_ID: "session-1" } }, "darwin")

    expect(result.command).toContain("ops/tool-process-supervisor-darwin.sh")
    expect(result.command).toContain(shellQuote("npm test"))
    expect(result.env.PI_SESSION_ID).toBe("session-1")
    expect(result.env.PI_STATION_TOOL_UNIT).toBeUndefined()
  })

  it("rejects platforms without a process isolation implementation", () => {
    expect(() => isolateToolProcess({ command: "npm test", cwd: "/workspace/project", env: {} }, "win32")).toThrow("does not support")
  })

  it("quotes commands without allowing the supervisor command to change", () => {
    expect(shellQuote("echo 'ok'; touch /tmp/nope")).toBe("'echo '\\''ok'\\''; touch /tmp/nope'")
  })

  it("owns completion, cancellation, descendants, and private command transport", async () => {
    const supervisor = await readFile(resolve(import.meta.dirname, "../../../../ops/tool-process-supervisor.sh"), "utf8")
    const runner = await readFile(resolve(import.meta.dirname, "../../../../ops/tool-process-runner.sh"), "utf8")
    const darwinSupervisor = await readFile(resolve(import.meta.dirname, "../../../../ops/tool-process-supervisor-darwin.sh"), "utf8")
    expect(supervisor).toContain("systemctl --user show-environment")
    expect(supervisor).toContain("mktemp")
    expect(supervisor).toContain("chmod 600")
    expect(supervisor).toContain('systemctl --user stop "$unit"')
    expect(supervisor).toContain("--wait")
    expect(supervisor).toContain("--property=KillMode=control-group")
    expect(supervisor).toContain("--property=RemainAfterExit=no")
    expect(runner).toContain("/usr/bin/env -i")
    expect(runner).toContain("owner_is_alive")
    expect(runner).toContain('systemctl --user stop "$unit"')
    expect(darwinSupervisor).toContain('pgrep -P "$parent"')
    expect(darwinSupervisor).toContain('kill -TERM "$parent"')
  })
})
