export const DEPLOYMENT_UNIT = "pi-station-deploy"
export const ACTIVE_SERVICE = "pi-station.service"
export const OBSOLETE_SERVICE = "pi-station-rpc-v2.service"
export const DEPLOYMENT_WORKER_SCRIPT = "deploy:local:worker"

export function shouldRequestDetachedDeployment(environment) {
  return environment.PI_SESSION_ID !== undefined
    && environment.PI_STATION_DEPLOY_DETACHED !== "1"
}

export const DEPLOYMENT_ORIGIN_VARIABLES = ["PI_STATION_WEB_ORIGIN", "PI_STATION_LOCAL_ORIGIN"]

export function detachedDeploymentArguments({ root, node, npmCli, environment = {} }) {
  const configuredOrigins = DEPLOYMENT_ORIGIN_VARIABLES.flatMap((name) => (
    environment[name] === undefined ? [] : [`--setenv=${name}=${environment[name]}`]
  ))
  return [
    "--user",
    `--unit=${DEPLOYMENT_UNIT}`,
    "--collect",
    "--property=Type=exec",
    "--property=TimeoutStartSec=15min",
    `--working-directory=${root}`,
    "--setenv=PI_STATION_DEPLOY_DETACHED=1",
    ...configuredOrigins,
    node,
    npmCli,
    "run",
    DEPLOYMENT_WORKER_SCRIPT,
  ]
}

export function serviceMigrationActions({ activeServiceIsActive, obsoleteServiceIsActive }) {
  if (activeServiceIsActive && obsoleteServiceIsActive) {
    throw new Error("Both the current and obsolete Pi Station services are active")
  }
  if (obsoleteServiceIsActive) {
    return [
      ["disable", "--now", OBSOLETE_SERVICE],
      ["enable", "--now", ACTIVE_SERVICE],
    ]
  }
  return activeServiceIsActive
    ? [["restart", ACTIVE_SERVICE]]
    : [["enable", "--now", ACTIVE_SERVICE]]
}
