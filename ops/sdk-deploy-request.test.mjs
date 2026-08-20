import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ACTIVE_SERVICE,
  DEPLOYMENT_UNIT,
  DEPLOYMENT_WORKER_SCRIPT,
  OBSOLETE_SERVICE,
  detachedDeploymentArguments,
  serviceMigrationActions,
  shouldRequestDetachedDeployment,
} from "./sdk-deploy-request.mjs"

const root = resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))

describe("SDK deployment request", () => {
  it("hands off only once when deployment starts inside a Pi Session", () => {
    expect(shouldRequestDetachedDeployment({ PI_SESSION_ID: "session-1" })).toBe(true)
    expect(shouldRequestDetachedDeployment({ PI_SESSION_ID: "session-1", PI_STATION_DEPLOY_DETACHED: "1" })).toBe(false)
    expect(shouldRequestDetachedDeployment({})).toBe(false)
  })

  it("hands the controlled user unit to the canonical worker", () => {
    expect(detachedDeploymentArguments({ root: "/repo", node: "/node", npmCli: "/npm-cli.js" })).toEqual([
      "--user",
      `--unit=${DEPLOYMENT_UNIT}`,
      "--collect",
      "--property=Type=exec",
      "--property=TimeoutStartSec=15min",
      "--working-directory=/repo",
      "--setenv=PI_STATION_DEPLOY_DETACHED=1",
      "/node",
      "/npm-cli.js",
      "run",
      DEPLOYMENT_WORKER_SCRIPT,
    ])
    expect(packageJson.scripts[DEPLOYMENT_WORKER_SCRIPT]).toBe("node ops/sdk-deploy-worker.mjs")
  })

  it("passes explicit origins through a detached deployment", () => {
    const arguments_ = detachedDeploymentArguments({
      root: "/repo",
      node: "/node",
      npmCli: "/npm-cli.js",
      environment: {
        PI_STATION_WEB_ORIGIN: "https://station.example.test:9443",
        PI_STATION_LOCAL_ORIGIN: "http://127.0.0.1:9900",
      },
    })
    expect(arguments_).toContain("--setenv=PI_STATION_WEB_ORIGIN=https://station.example.test:9443")
    expect(arguments_).toContain("--setenv=PI_STATION_LOCAL_ORIGIN=http://127.0.0.1:9900")
    expect(arguments_.indexOf("--setenv=PI_STATION_DEPLOY_DETACHED=1")).toBeLessThan(arguments_.indexOf("/node"))
  })

  it("does not invent origin overrides during a detached deployment", () => {
    const arguments_ = detachedDeploymentArguments({ root: "/repo", node: "/node", npmCli: "/npm-cli.js" })
    expect(arguments_.some((argument) => argument.startsWith("--setenv=PI_STATION_WEB_ORIGIN="))).toBe(false)
    expect(arguments_.some((argument) => argument.startsWith("--setenv=PI_STATION_LOCAL_ORIGIN="))).toBe(false)
  })

  it("passes the caller environment into the detached handoff", () => {
    const deployment = readFileSync(resolve(root, "ops/sdk-deploy.mjs"), "utf8")
    expect(deployment).toContain("environment: process.env")
  })

  it("keeps the public handoff separate from the non-recursive worker", () => {
    expect(packageJson.scripts["deploy:local"]).toBe("node ops/sdk-deploy.mjs")
    expect(DEPLOYMENT_WORKER_SCRIPT).not.toBe("deploy:local")
    expect(packageJson.scripts[DEPLOYMENT_WORKER_SCRIPT]).not.toContain("sdk-deploy.mjs")
  })

  it("does not reference the removed deployment script", () => {
    const removedScript = ["deploy", "local", "sdk"].join(":")
    const deploymentFiles = [
      "package.json",
      "ops/sdk-deploy.mjs",
      "ops/sdk-deploy-worker.mjs",
      "ops/sdk-deploy-request.mjs",
    ]
    for (const file of deploymentFiles) {
      expect(readFileSync(resolve(root, file), "utf8")).not.toContain(removedScript)
    }
  })
})

describe("Pi Station service migration", () => {
  it("disables the obsolete unit before it starts the canonical unit", () => {
    expect(serviceMigrationActions({ activeServiceIsActive: false, obsoleteServiceIsActive: true })).toEqual([
      ["disable", "--now", OBSOLETE_SERVICE],
      ["enable", "--now", ACTIVE_SERVICE],
    ])
  })

  it("restarts an active canonical unit without touching the obsolete unit", () => {
    expect(serviceMigrationActions({ activeServiceIsActive: true, obsoleteServiceIsActive: false })).toEqual([
      ["restart", ACTIVE_SERVICE],
    ])
  })

  it("refuses an ambiguous state with both units active", () => {
    expect(() => serviceMigrationActions({ activeServiceIsActive: true, obsoleteServiceIsActive: true }))
      .toThrow("Both the current and obsolete Pi Station services are active")
  })
})
