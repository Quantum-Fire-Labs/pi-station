#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Pi Station installer: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null || fail "Node.js 22.19 or newer is required"
command -v systemctl >/dev/null || fail "systemd user services are required"
command -v curl >/dev/null || fail "curl is required"
systemctl --user show-environment >/dev/null 2>&1 || fail "the systemd user manager is unavailable"

node_version=$(node -p 'process.versions.node')
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 19) ? 0 : 1)' || \
  fail "Node.js 22.19 or newer is required; found ${node_version}"

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$source_dir/VERSION" && -f "$source_dir/apps/server/dist/cli.js" && -d "$source_dir/node_modules" ]] || \
  fail "run install.sh from an extracted Pi Station release artifact"
version=$(tr -d '\r\n' < "$source_dir/VERSION")
[[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]] || fail "the release version is invalid"

install_root=${PI_STATION_INSTALL_ROOT:-"$HOME/.local/share/pi-station/app"}
config_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/pi-station
unit_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
version_dir="$install_root/$version"
current_link="$install_root/current"
unit_file="$unit_dir/pi-station.service"
environment_file="$config_dir/environment"
node_bin=$(command -v node)
service_path="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.mise/shims:$PATH"
environment_value() {
  node - "$1" "$2" <<'NODE'
const { existsSync, readFileSync } = require("node:fs")
const [file, key] = process.argv.slice(2)
if (!existsSync(file)) process.exit(1)
const prefix = `${key}=`
const line = readFileSync(file, "utf8").split(/\r?\n/u).find((entry) => entry.startsWith(prefix))
if (line === undefined) process.exit(1)
const raw = line.slice(prefix.length)
process.stdout.write(raw.startsWith('"') ? JSON.parse(raw) : raw)
NODE
}
port=${PI_STATION_PORT:-$(environment_value "$environment_file" PI_STATION_PORT || printf '8801')}
data_dir=${PI_STATION_DATA_DIR:-$(environment_value "$environment_file" PI_STATION_DATA_DIR || printf '%s' "$HOME/.local/share/pi-station")}
retired_shared_root="$HOME/.pi/agent/pi-station/shared"
if [[ -n "${PI_STATION_SHARED_ROOT:-}" ]]; then
  shared_root=$PI_STATION_SHARED_ROOT
else
  saved_shared_root=$(environment_value "$environment_file" PI_STATION_SHARED_ROOT || true)
  if [[ -z "$saved_shared_root" || "$saved_shared_root" == "$retired_shared_root" ]]; then shared_root="$data_dir/shared"; else shared_root=$saved_shared_root; fi
fi
local_origin=${PI_STATION_LOCAL_ORIGIN:-$(environment_value "$environment_file" PI_STATION_LOCAL_ORIGIN || printf 'http://127.0.0.1:%s' "$port")}
web_origin=${PI_STATION_WEB_ORIGIN:-$(environment_value "$environment_file" PI_STATION_WEB_ORIGIN || printf '%s' "$local_origin")}
unit_quote() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }
unit_path() { local value=$1; value=${value//\\/\\x5c}; value=${value//%/%%}; value=${value// /\\x20}; value=${value//$'\t'/\\x09}; printf '%s' "$value"; }

[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || fail "PI_STATION_PORT is invalid"

old_release=$(readlink "$current_link" 2>/dev/null || true)
[[ "$old_release" != "$version_dir" ]] || fail "Pi Station $version is already installed"
rollback_dir=
release_switched=0
rollback() {
  local status=$?
  trap - EXIT
  if (( release_switched )); then
    printf 'Pi Station installer: installation failed; restoring the previous release.\n' >&2
    systemctl --user stop pi-station.service >/dev/null 2>&1 || true
    if [[ -n "$old_release" && -d "$old_release" ]]; then
      ln -sfn "$old_release" "$current_link.rollback"
      mv -Tf "$current_link.rollback" "$current_link"
    else
      rm -f "$current_link"
    fi
    if [[ -n "$rollback_dir" && -f "$rollback_dir/environment" ]]; then cp "$rollback_dir/environment" "$environment_file"; else rm -f "$environment_file"; fi
    if [[ -n "$rollback_dir" && -f "$rollback_dir/service" ]]; then cp "$rollback_dir/service" "$unit_file"; else rm -f "$unit_file"; fi
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if [[ -n "$old_release" && -d "$old_release" ]]; then systemctl --user start pi-station.service >/dev/null 2>&1 || true; fi
    rm -rf -- "$version_dir"
  fi
  [[ -z "$rollback_dir" ]] || rm -rf -- "$rollback_dir"
  exit "$status"
}
trap rollback EXIT

old_pi_pids=$(pgrep -f '/pi( |$)' 2>/dev/null | sort || true)
service_active=0
if systemctl --user is-active --quiet pi-station.service; then
  service_active=1
  deadline=$((SECONDS + 300))
  while (( SECONDS < deadline )); do
    active_turns=$(curl --fail --silent "$local_origin/healthz" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).activeTurns))}catch{process.exit(1)}})' || true)
    [[ "$active_turns" == "0" ]] && break
    sleep 1
  done
  [[ "${active_turns:-}" == "0" ]] || fail "Pi Station did not drain active turns"
fi

if [[ "$shared_root" == "$data_dir/shared" && ! -e "$shared_root" && -d "$retired_shared_root" ]]; then
  mkdir -p "$data_dir"
  mv "$retired_shared_root" "$shared_root"
  ln -s "$shared_root" "$retired_shared_root"
fi
mkdir -p "$install_root" "$data_dir" "$shared_root" "$config_dir" "$unit_dir"
rollback_dir=$(mktemp -d "$install_root/.rollback.XXXXXX")
[[ ! -f "$environment_file" ]] || cp "$environment_file" "$rollback_dir/environment"
[[ ! -f "$unit_file" ]] || cp "$unit_file" "$rollback_dir/service"
rm -rf -- "$version_dir.new"
mkdir -p "$version_dir.new"
cp -a "$source_dir/." "$version_dir.new/"
rm -f "$version_dir.new/install.sh"
rm -rf -- "$version_dir"
mv "$version_dir.new" "$version_dir"
ln -sfn "$version_dir" "$current_link.new"
mv -Tf "$current_link.new" "$current_link"
release_switched=1

cat > "$environment_file" <<EOF
PI_STATION_PORT=$(unit_quote "$port")
PI_STATION_DATA_DIR=$(unit_quote "$data_dir")
PI_STATION_SHARED_ROOT=$(unit_quote "$shared_root")
PI_STATION_WEB_ROOT=$(unit_quote "$current_link/apps/web/dist")
PI_STATION_WEB_ORIGIN=$(unit_quote "$web_origin")
PI_STATION_LOCAL_ORIGIN=$(unit_quote "$local_origin")
PATH=$(unit_quote "$service_path")
EOF
chmod 600 "$environment_file"

cat > "$unit_file" <<EOF
[Unit]
Description=Pi Station
After=network.target

[Service]
Type=simple
WorkingDirectory=$(unit_path "$current_link")
ExecStart=$(unit_quote "$node_bin") apps/server/dist/cli.js
Restart=on-failure
RestartSec=2
KillMode=process
Environment=NODE_ENV=production
EnvironmentFile=$(unit_path "$environment_file")

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable pi-station.service >/dev/null
if (( service_active )); then
  systemctl --user restart pi-station.service
else
  systemctl --user start pi-station.service
fi

healthy=0
for _ in {1..40}; do
  if curl --fail --silent "$local_origin/healthz" | grep -q '"status":"ok"'; then healthy=1; break; fi
  sleep 0.25
done
(( healthy )) || fail "the service did not become healthy; run: journalctl --user -u pi-station.service"
curl --fail --silent "$local_origin/workspace" >/dev/null
new_pi_pids=$(pgrep -f '/pi( |$)' 2>/dev/null | sort || true)
[[ "$new_pi_pids" == "$old_pi_pids" ]] || fail "a Pi process PID changed during installation"

release_switched=0
rm -rf -- "$rollback_dir"
rollback_dir=
trap - EXIT
printf 'Pi Station %s is installed.\nOpen %s/workspace\n' "$version" "$local_origin"
