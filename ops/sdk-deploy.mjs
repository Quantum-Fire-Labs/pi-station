import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import {
  DEPLOYMENT_WORKER_SCRIPT,
  detachedDeploymentArguments,
  shouldRequestDetachedDeployment,
} from "./sdk-deploy-request.mjs"

const root = resolve(import.meta.dirname, "..")
const npmCli = process.env.npm_execpath
if (npmCli === undefined) throw new Error("Deployment must run through npm")

if (shouldRequestDetachedDeployment(process.env)) {
  execFileSync(
    "systemd-run",
    detachedDeploymentArguments({ root, node: process.execPath, npmCli, environment: process.env }),
    { stdio: "inherit" },
  )
  console.log("Pi Station deployment was handed to the user service manager and will start after this Session becomes idle.")
} else {
  execFileSync(process.execPath, [npmCli, "run", DEPLOYMENT_WORKER_SCRIPT], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  })
}
