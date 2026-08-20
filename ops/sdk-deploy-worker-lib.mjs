export const dependencyPreparationArguments = [
  "ci",
  "--ignore-scripts",
  "--include=dev",
  "--workspaces",
  "--include-workspace-root",
]

export const validationArguments = [
  ["run", "check"],
  ["run", "build"],
]

export function prepareAndValidate(runNpm) {
  runNpm(dependencyPreparationArguments)
  for (const args of validationArguments) runNpm(args)
}

export function deployAfterValidation({ runNpm, deploy }) {
  prepareAndValidate(runNpm)
  deploy()
}

const systemdQuote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
const systemdWorkingDirectory = (value) => value.replaceAll("\\", "\\x5c").replaceAll("%", "%%").replaceAll(" ", "\\x20").replaceAll("\t", "\\x09")

export function buildSystemdService({ root, node, dataDir, sharedRoot, port = "8801", webOrigin, localOrigin, path }) {
  const loopbackOrigin = `http://127.0.0.1:${port}`
  return `[Unit]
Description=Pi Station
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdWorkingDirectory(root)}
ExecStart=${systemdQuote(node)} apps/server/dist/cli.js
Restart=on-failure
RestartSec=2
KillMode=process
Environment="NODE_ENV=production"
Environment=${systemdQuote(`PI_STATION_PORT=${port}`)}
Environment=${systemdQuote(`PI_STATION_DATA_DIR=${dataDir}`)}
Environment=${systemdQuote(`PI_STATION_SHARED_ROOT=${sharedRoot}`)}
Environment=${systemdQuote(`PI_STATION_WEB_ROOT=${root}/apps/web/dist`)}
Environment=${systemdQuote(`PI_STATION_WEB_ORIGIN=${webOrigin ?? loopbackOrigin}`)}
Environment=${systemdQuote(`PI_STATION_LOCAL_ORIGIN=${localOrigin ?? loopbackOrigin}`)}
Environment=${systemdQuote(`PATH=${path}`)}

[Install]
WantedBy=default.target
`
}
