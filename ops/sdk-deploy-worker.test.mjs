import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"
import {
  buildSystemdService,
  dependencyPreparationArguments,
  deployAfterValidation,
  parseSystemdEnvironment,
  resolveDeploymentOrigins,
  validationArguments,
} from "./sdk-deploy-worker-lib.mjs"

describe("SDK deployment worker", () => {
  it("preserves custom origins from the effective service environment, including drop-ins", () => {
    const effective = 'NODE_ENV=production "PI_STATION_WEB_ORIGIN=https://station.example.test:9443" PI_STATION_LOCAL_ORIGIN=http://127.0.0.1:9900'
    expect(parseSystemdEnvironment(effective)).toMatchObject({
      PI_STATION_WEB_ORIGIN: "https://station.example.test:9443",
      PI_STATION_LOCAL_ORIGIN: "http://127.0.0.1:9900",
    })
    expect(resolveDeploymentOrigins({ effectiveEnvironment: effective, port: "8801" })).toEqual({
      webOrigin: "https://station.example.test:9443",
      localOrigin: "http://127.0.0.1:9900",
    })
  })

  it("gives explicit deployment origins priority over effective service values", () => {
    expect(resolveDeploymentOrigins({
      environment: {
        PI_STATION_WEB_ORIGIN: "https://override.example.test",
        PI_STATION_LOCAL_ORIGIN: "http://127.0.0.1:7777",
      },
      effectiveEnvironment: "PI_STATION_WEB_ORIGIN=https://saved.example.test PI_STATION_LOCAL_ORIGIN=http://127.0.0.1:9900",
      port: "8801",
    })).toEqual({ webOrigin: "https://override.example.test", localOrigin: "http://127.0.0.1:7777" })
  })

  it("uses loopback origins for a new installation", () => {
    expect(resolveDeploymentOrigins({ port: "8811" })).toEqual({
      webOrigin: "http://127.0.0.1:8811",
      localOrigin: "http://127.0.0.1:8811",
    })
  })

  it("rejects values that are not exact HTTP origins", () => {
    expect(() => resolveDeploymentOrigins({ environment: { PI_STATION_WEB_ORIGIN: "https://station.example.test/path" } })).toThrow("HTTP or HTTPS origin")
  })

  it("generates the service from deployment inputs without maintainer paths", () => {
    const service = buildSystemdService({
      root: "/home/example/Pi Station",
      node: "/usr/bin/node",
      dataDir: "/home/example/.local/share/pi-station",
      sharedRoot: "/home/example/.pi/agent/pi-station/shared",
      port: "9900",
      webOrigin: "https://station.example.test:9443",
      localOrigin: "http://127.0.0.1:9900",
      path: "/usr/local/bin:/usr/bin",
    })

    expect(service).toContain("WorkingDirectory=/home/example/Pi\\x20Station")
    expect(service).toContain('ExecStart="/usr/bin/node" apps/server/dist/cli.js')
    expect(service).toContain('Environment="PI_STATION_PORT=9900"')
    expect(service).toContain('Environment="PI_STATION_WEB_ORIGIN=https://station.example.test:9443"')
    expect(service).toContain('Environment="PI_STATION_LOCAL_ORIGIN=http://127.0.0.1:9900"')
  })

  it("reads the effective service environment so systemd drop-ins are preserved", async () => {
    const worker = await readFile(new URL("./sdk-deploy-worker.mjs", import.meta.url), "utf8")
    expect(worker).toContain('"show", name, "--property=Environment", "--value"')
    expect(worker).toContain("effectiveEnvironment: existingServiceEnvironment")
  })

  it("checks the configured web origin after deployment", async () => {
    const worker = await readFile(new URL("./sdk-deploy-worker.mjs", import.meta.url), "utf8")
    expect(worker).toContain('"--header", `Origin: ${webOrigin}`')
    expect(worker).toContain('`${healthOrigin}/v2/projects`')
  })

  it("prepares the locked workspace development dependencies without lifecycle scripts", () => {
    expect(dependencyPreparationArguments).toEqual([
      "ci",
      "--ignore-scripts",
      "--include=dev",
      "--workspaces",
      "--include-workspace-root",
    ])
  })

  it("prepares dependencies before check and build", () => {
    const calls = []
    deployAfterValidation({
      runNpm: (args) => calls.push(args),
      deploy: () => calls.push("deploy"),
    })

    expect(calls).toEqual([
      dependencyPreparationArguments,
      ...validationArguments,
      "deploy",
    ])
  })

  it.each([0, 1, 2])("does not migrate data or change services when preparation or validation step %i fails", (failureIndex) => {
    const deploy = vi.fn()
    let callIndex = 0

    expect(() => deployAfterValidation({
      runNpm: () => {
        if (callIndex === failureIndex) throw new Error("command failed")
        callIndex += 1
      },
      deploy,
    })).toThrow("command failed")
    expect(deploy).not.toHaveBeenCalled()
  })
})
