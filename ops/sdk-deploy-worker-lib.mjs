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

export function parseSystemdEnvironment(value) {
  const entries = []
  let entry = ""
  let quote
  let escaped = false
  for (const character of value) {
    if (escaped) { entry += character; escaped = false; continue }
    if (character === "\\") { escaped = true; continue }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else entry += character
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    if (/\s/u.test(character)) {
      if (entry !== "") { entries.push(entry); entry = "" }
      continue
    }
    entry += character
  }
  if (escaped) entry += "\\"
  if (entry !== "") entries.push(entry)
  return Object.fromEntries(entries.flatMap((item) => {
    const separator = item.indexOf("=")
    return separator < 1 ? [] : [[item.slice(0, separator), item.slice(separator + 1)]]
  }))
}

function deploymentOrigin(value, fallback, name) {
  const candidate = value ?? fallback
  let parsed
  try { parsed = new URL(candidate) } catch { throw new Error(`${name} must be an HTTP or HTTPS origin`) }
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`${name} must be an HTTP or HTTPS origin`)
  }
  return parsed.origin
}

export function resolveDeploymentOrigins({ environment = {}, effectiveEnvironment = "", port = "8801" }) {
  const existing = parseSystemdEnvironment(effectiveEnvironment)
  const loopback = `http://127.0.0.1:${port}`
  return {
    webOrigin: deploymentOrigin(environment.PI_STATION_WEB_ORIGIN, existing.PI_STATION_WEB_ORIGIN ?? loopback, "PI_STATION_WEB_ORIGIN"),
    localOrigin: deploymentOrigin(environment.PI_STATION_LOCAL_ORIGIN, existing.PI_STATION_LOCAL_ORIGIN ?? loopback, "PI_STATION_LOCAL_ORIGIN"),
  }
}

export function resolveDeploymentSharedRoot({ dataDir, retiredDefault, environment = {}, effectiveEnvironment = "" }) {
  if (environment.PI_STATION_SHARED_ROOT !== undefined) return environment.PI_STATION_SHARED_ROOT
  const saved = parseSystemdEnvironment(effectiveEnvironment).PI_STATION_SHARED_ROOT
  if (saved !== undefined && saved !== retiredDefault) return saved
  return `${dataDir}/shared`
}

export function resolveServicePath({ home, path = "/usr/local/bin:/usr/bin:/bin" }) {
  const userDirectories = [`${home}/.local/bin`, `${home}/.local/share/mise/shims`, `${home}/.mise/shims`]
  return [...new Set([...userDirectories, ...path.split(":").filter(Boolean)])].join(":")
}

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
