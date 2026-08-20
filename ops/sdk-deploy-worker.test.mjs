import { describe, expect, it, vi } from "vitest"
import {
  buildSystemdService,
  dependencyPreparationArguments,
  deployAfterValidation,
  validationArguments,
} from "./sdk-deploy-worker-lib.mjs"

describe("SDK deployment worker", () => {
  it("generates the service from deployment inputs without maintainer paths", () => {
    const service = buildSystemdService({
      root: "/home/example/Pi Station",
      node: "/usr/bin/node",
      dataDir: "/home/example/.local/share/pi-station",
      sharedRoot: "/home/example/.pi/agent/pi-station/shared",
      port: "9900",
      path: "/usr/local/bin:/usr/bin",
    })

    expect(service).toContain("WorkingDirectory=/home/example/Pi\\x20Station")
    expect(service).toContain('ExecStart="/usr/bin/node" apps/server/dist/cli.js')
    expect(service).toContain('Environment="PI_STATION_PORT=9900"')
    expect(service).toContain("http://127.0.0.1:9900")
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
