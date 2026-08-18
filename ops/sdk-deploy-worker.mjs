import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import {
  ACTIVE_SERVICE,
  OBSOLETE_SERVICE,
  serviceMigrationActions,
} from "./sdk-deploy-request.mjs"
import { buildSystemdService, prepareAndValidate } from "./sdk-deploy-worker-lib.mjs"

const root = resolve(import.meta.dirname, "..")
const userUnits = resolve(homedir(), ".config/systemd/user")
const installedUnit = resolve(userUnits, ACTIVE_SERVICE)
const obsoleteInstalledUnit = resolve(userUnits, OBSOLETE_SERVICE)
const npmCli = process.env.npm_execpath
if (npmCli === undefined) throw new Error("Deployment worker must run through npm")
const nodeBin = dirname(process.execPath)

function run(file, args, options = {}) {
  const output = execFileSync(file, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
    env: {
      ...process.env,
      PATH: `${nodeBin}:${process.env.PATH ?? ""}`,
      ...options.env,
    },
  })
  return typeof output === "string" ? output.trim() : ""
}

function sessionPids() {
  try {
    const output = run("pgrep", ["-f", "/pi( |$)"], { shell: false })
    return output === "" ? [] : output.split("\n").sort()
  } catch {
    return []
  }
}

const isServiceActive = (name) => {
  try {
    return run("systemctl", ["--user", "is-active", name]) === "active"
  } catch {
    return false
  }
}

const runNpm = (args) => run(process.execPath, [npmCli, ...args], {
  stdio: "inherit",
  env: { WATCH_REPORT_DEPENDENCIES: undefined },
})

prepareAndValidate(runNpm)

const piPidsBefore = sessionPids()
const activeServiceIsActive = isServiceActive(ACTIVE_SERVICE)
const obsoleteServiceIsActive = isServiceActive(OBSOLETE_SERVICE)
const serviceWasActive = activeServiceIsActive || obsoleteServiceIsActive
const migrationActions = serviceMigrationActions({ activeServiceIsActive, obsoleteServiceIsActive })
const canonicalDataDir = resolve(homedir(), ".local/share/pi-station")
const retiredDataDir = resolve(homedir(), ".local/share/pi-station-rpc-v2")
const dataDir = resolve(process.env.PI_STATION_DATA_DIR ?? process.env.PI_STATION_RPC_V2_DATA_DIR ?? canonicalDataDir)
if (process.env.PI_STATION_DATA_DIR === undefined && process.env.PI_STATION_RPC_V2_DATA_DIR === undefined && !existsSync(canonicalDataDir) && existsSync(retiredDataDir)) renameSync(retiredDataDir, canonicalDataDir)
const port = process.env.PI_STATION_PORT ?? "8801"
if (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65_535) throw new Error("PI_STATION_PORT is invalid")
const healthOrigin = `http://127.0.0.1:${port}`
const maintenanceFile = resolve(dataDir, "maintenance.json")
const temporaryMaintenanceFile = `${maintenanceFile}.${process.pid}.tmp`
mkdirSync(dataDir, { recursive: true })
writeFileSync(temporaryMaintenanceFile, `${JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid })}\n`, { mode: 0o600 })
renameSync(temporaryMaintenanceFile, maintenanceFile)

try {
  // Give open Workspace clients enough time to observe the marker before the service stops.
  run("sleep", ["1.25"])

  if (serviceWasActive) {
    const drainDeadline = Date.now() + 5 * 60_000
    let activeTurns = -1
    while (Date.now() < drainDeadline) {
      const health = JSON.parse(run("curl", ["--fail", "--silent", `${healthOrigin}/healthz`]))
      activeTurns = health.activeTurns
      if (activeTurns === 0) break
      run("sleep", ["1"])
    }
    if (activeTurns !== 0) throw new Error("Pi Station did not drain active turns")
  }

  mkdirSync(userUnits, { recursive: true })
  const sharedRoot = resolve(process.env.PI_STATION_SHARED_ROOT ?? resolve(homedir(), ".pi/agent/pi-station/shared"))
  writeFileSync(installedUnit, buildSystemdService({
    root,
    node: process.execPath,
    dataDir,
    sharedRoot,
    port,
    webOrigin: process.env.PI_STATION_WEB_ORIGIN,
    localOrigin: process.env.PI_STATION_LOCAL_ORIGIN,
    path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  }))
  run("systemctl", ["--user", "daemon-reload"])
  for (const action of migrationActions) run("systemctl", ["--user", ...action])
  if (existsSync(obsoleteInstalledUnit)) {
    if (!obsoleteServiceIsActive) run("systemctl", ["--user", "disable", OBSOLETE_SERVICE])
    rmSync(obsoleteInstalledUnit, { force: true })
    run("systemctl", ["--user", "daemon-reload"])
  }

  let stationHealth
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      stationHealth = JSON.parse(run("curl", ["--fail", "--silent", `${healthOrigin}/healthz`]))
      break
    } catch {
      run("sleep", ["0.25"])
    }
  }
  if (stationHealth?.status !== "ok" || stationHealth.activeTurns !== 0) {
    throw new Error("Pi Station health check failed")
  }
  run("curl", ["--fail", "--silent", `${healthOrigin}/workspace`])

  if (JSON.stringify(sessionPids()) !== JSON.stringify(piPidsBefore)) {
    throw new Error("A Pi process PID changed during Pi Station deployment")
  }
} finally {
  rmSync(temporaryMaintenanceFile, { force: true })
  rmSync(maintenanceFile, { force: true })
}

console.log("Pi Station SDK deployment complete. The obsolete service is inactive and Pi Session PIDs are unchanged.")
