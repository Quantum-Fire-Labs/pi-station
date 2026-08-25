#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Pi Station Tailscale setup: %s\n' "$*" >&2; exit 1; }
command -v tailscale >/dev/null 2>&1 || fail "tailscale is required"
command -v systemctl >/dev/null 2>&1 || fail "systemctl is required; this setup currently supports Linux installations"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "Node.js is required"

service=pi-station.service
environment_file=${PI_STATION_ENVIRONMENT_FILE:-"$HOME/.config/pi-station/environment"}
dropin_directory=${PI_STATION_SYSTEMD_DROPIN_DIR:-"$HOME/.config/systemd/user/pi-station.service.d"}
dropin_file="$dropin_directory/90-tailscale-origin.conf"
https_port=${PI_STATION_TAILSCALE_HTTPS_PORT:-443}
remote_attempts=${PI_STATION_TAILSCALE_REMOTE_ATTEMPTS:-60}
[[ "$remote_attempts" =~ ^[0-9]+$ ]] && (( remote_attempts >= 1 )) || fail "PI_STATION_TAILSCALE_REMOTE_ATTEMPTS is invalid"
[[ "$https_port" =~ ^[0-9]+$ ]] && (( https_port >= 1 && https_port <= 65535 )) || fail "PI_STATION_TAILSCALE_HTTPS_PORT is invalid"
[[ -f "$environment_file" ]] || fail "Pi Station environment file was not found at $environment_file"
systemctl --user cat "$service" >/dev/null 2>&1 || fail "$service is not installed"

port=$(node -e '
const fs = require("node:fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const match = /^PI_STATION_PORT=(?:"([^"]*)"|(\S+))$/m.exec(text);
if (!match) process.exit(1);
process.stdout.write(match[1] ?? match[2]);
' "$environment_file") || fail "PI_STATION_PORT is missing from $environment_file"
[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || fail "the installed Pi Station port is invalid"

status_json=$(tailscale status --json) || fail "could not read Tailscale status"
dns_name=$(printf '%s' "$status_json" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const status = JSON.parse(input);
  if (status.BackendState !== "Running") throw new Error("Tailscale is not connected");
  const name = status.Self?.DNSName?.replace(/\.$/u, "");
  if (typeof name !== "string" || !/^[A-Za-z0-9.-]+$/u.test(name)) throw new Error("MagicDNS name is unavailable");
  process.stdout.write(name);
});
') || fail "Tailscale must be connected with a MagicDNS name"
if [[ "$https_port" == "443" ]]; then web_origin="https://$dns_name"; else web_origin="https://$dns_name:$https_port"; fi
local_origin="http://127.0.0.1:$port"

serve_status=$(tailscale serve status --json 2>/dev/null || printf '{}')
printf '%s' "$serve_status" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const status = JSON.parse(input || "{}");
  const port = process.argv[1];
  const expected = process.argv[2];
  if (status.TCP?.[port] === undefined) return;
  const handlers = Object.entries(status.Web ?? {}).filter(([key]) => key.endsWith(`:${port}`)).flatMap(([, value]) => Object.values(value.Handlers ?? {}));
  if (!handlers.some((handler) => handler.Proxy === expected)) {
    console.error(`Tailscale Serve HTTPS port ${port} is already in use`);
    process.exit(1);
  }
});
' "$https_port" "$local_origin" || fail "choose another port with PI_STATION_TAILSCALE_HTTPS_PORT"

work_directory=$(mktemp -d "${TMPDIR:-/tmp}/pi-station-tailscale.XXXXXX")
trap 'rm -rf -- "$work_directory"' EXIT
serve_backup="$work_directory/serve.json"
tailscale serve get-config "$serve_backup" --all >/dev/null
had_dropin=0
if [[ -f "$dropin_file" ]]; then cp "$dropin_file" "$work_directory/origin.conf"; had_dropin=1; fi
changed=0
rollback() {
  (( changed )) || return 0
  printf 'Validation failed; restoring the previous Pi Station and Tailscale configuration...\n' >&2
  if (( had_dropin )); then cp "$work_directory/origin.conf" "$dropin_file"; else rm -f "$dropin_file"; fi
  tailscale serve set-config "$serve_backup" --all >/dev/null 2>&1 || true
  systemctl --user daemon-reload || true
  systemctl --user restart "$service" || true
}
trap 'status=$?; if (( status != 0 )); then rollback; fi; rm -rf -- "$work_directory"; exit "$status"' EXIT

printf 'Pi Station grants connected clients the host user authority available to its tools.\n'
printf 'Enabling tailnet-only access at %s (Tailscale Funnel is not used).\n' "$web_origin"
mkdir -p "$dropin_directory"
printf '[Service]\nEnvironment="PI_STATION_WEB_ORIGIN=%s"\n' "$web_origin" > "$dropin_file"
chmod 600 "$dropin_file"
changed=1
systemctl --user daemon-reload
systemctl --user restart "$service"

healthy=0
for _ in $(seq 1 40); do
  if curl --fail --silent "$local_origin/healthz" | node -e '
let input = ""; process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => process.exit(JSON.parse(input).status === "ok" ? 0 : 1));
' >/dev/null 2>&1; then healthy=1; break; fi
  sleep 0.25
done
(( healthy )) || fail "Pi Station did not become healthy after its origin changed"

curl --fail --silent --output /dev/null --request OPTIONS --header "Origin: $web_origin" "$local_origin/v2/projects" || fail "Pi Station rejected the Tailscale origin"
tailscale serve --bg --yes --https="$https_port" "$local_origin" >/dev/null

remote_healthy=0
for _ in $(seq 1 "$remote_attempts"); do
  if curl --fail --silent "$web_origin/healthz" >/dev/null 2>&1 && curl --fail --silent "$web_origin/workspace" >/dev/null 2>&1; then remote_healthy=1; break; fi
  sleep 0.5
done
(( remote_healthy )) || fail "the Tailscale HTTPS endpoint did not become healthy"

changed=0
printf 'Pi Station is available to authorized tailnet devices at:\n%s/workspace\n' "$web_origin"
printf 'View the proxy with: tailscale serve status\n'
