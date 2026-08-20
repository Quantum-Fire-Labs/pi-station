#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Pi Station installer: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Darwin ]] || fail "this installer requires macOS"
command -v node >/dev/null || fail "Node.js 22.19 or newer is required"
command -v curl >/dev/null || fail "curl is required"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 19) ? 0 : 1)' || fail "Node.js 22.19 or newer is required"

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$source_dir/VERSION" && -f "$source_dir/apps/server/dist/cli.js" && -d "$source_dir/node_modules" ]] || fail "run install-macos.sh from an extracted Pi Station release artifact"
version=$(tr -d '\r\n' < "$source_dir/VERSION")
[[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]] || fail "the release version is invalid"

install_root=${PI_STATION_INSTALL_ROOT:-"$HOME/Library/Application Support/Pi Station/app"}
data_dir=${PI_STATION_DATA_DIR:-"$HOME/Library/Application Support/Pi Station"}
shared_root=${PI_STATION_SHARED_ROOT:-"$HOME/.pi/agent/pi-station/shared"}
version_dir="$install_root/$version"
current_link="$install_root/current"
label=works.pistation.server
agent_file="$HOME/Library/LaunchAgents/$label.plist"
node_bin=$(command -v node)
port=${PI_STATION_PORT:-8801}
local_origin=${PI_STATION_LOCAL_ORIGIN:-"http://127.0.0.1:$port"}
web_origin=${PI_STATION_WEB_ORIGIN:-"$local_origin"}
[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || fail "PI_STATION_PORT is invalid"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"; }

old_release=$(readlink "$current_link" 2>/dev/null || true)
[[ "$old_release" != "$version_dir" ]] || fail "Pi Station $version is already installed"
rollback_dir=
release_switched=0
service_active=0
rollback() {
  local status=$?
  trap - EXIT
  if (( release_switched )); then
    printf 'Pi Station installer: installation failed; restoring the previous release.\n' >&2
    launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
    if [[ -n "$old_release" && -d "$old_release" ]]; then
      ln -sfn "$old_release" "$current_link.rollback"
      mv -fh "$current_link.rollback" "$current_link"
    else
      rm -f "$current_link"
    fi
    if [[ -n "$rollback_dir" && -f "$rollback_dir/agent.plist" ]]; then cp "$rollback_dir/agent.plist" "$agent_file"; else rm -f "$agent_file"; fi
    if (( service_active )) && [[ -f "$agent_file" ]]; then launchctl bootstrap "gui/$UID" "$agent_file" >/dev/null 2>&1 || true; fi
    rm -rf -- "$version_dir"
  fi
  [[ -z "$rollback_dir" ]] || rm -rf -- "$rollback_dir"
  exit "$status"
}
trap rollback EXIT

old_pi_pids=$(pgrep -f '/pi( |$)' 2>/dev/null | sort || true)
if launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
  service_active=1
  deadline=$((SECONDS + 300))
  while (( SECONDS < deadline )); do
    active_turns=$(curl --fail --silent "$local_origin/healthz" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).activeTurns))}catch{process.exit(1)}})' || true)
    [[ "$active_turns" == "0" ]] && break
    sleep 1
  done
  [[ "${active_turns:-}" == "0" ]] || fail "Pi Station did not drain active turns"
  launchctl bootout "gui/$UID/$label"
fi

mkdir -p "$install_root" "$data_dir" "$shared_root" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/Pi Station"
rollback_dir=$(mktemp -d "$install_root/.rollback.XXXXXX")
[[ ! -f "$agent_file" ]] || cp "$agent_file" "$rollback_dir/agent.plist"
rm -rf -- "$version_dir.new"
mkdir -p "$version_dir.new"
cp -a "$source_dir/." "$version_dir.new/"
rm -f "$version_dir.new/install.sh" "$version_dir.new/install-macos.sh"
rm -rf -- "$version_dir"
mv "$version_dir.new" "$version_dir"
ln -sfn "$version_dir" "$current_link.new"
mv -fh "$current_link.new" "$current_link"
release_switched=1

cat > "$agent_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array><string>$(xml "$node_bin")</string><string>apps/server/dist/cli.js</string></array>
<key>WorkingDirectory</key><string>$(xml "$current_link")</string>
<key>EnvironmentVariables</key><dict>
<key>NODE_ENV</key><string>production</string>
<key>PI_STATION_PORT</key><string>$port</string>
<key>PI_STATION_DATA_DIR</key><string>$(xml "$data_dir")</string>
<key>PI_STATION_SHARED_ROOT</key><string>$(xml "$shared_root")</string>
<key>PI_STATION_WEB_ROOT</key><string>$(xml "$current_link/apps/web/dist")</string>
<key>PI_STATION_WEB_ORIGIN</key><string>$(xml "$web_origin")</string>
<key>PI_STATION_LOCAL_ORIGIN</key><string>$(xml "$local_origin")</string>
<key>PATH</key><string>$(xml "$(dirname "$node_bin"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")</string>
</dict>
<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>$(xml "$HOME/Library/Logs/Pi Station/server.log")</string>
<key>StandardErrorPath</key><string>$(xml "$HOME/Library/Logs/Pi Station/server-error.log")</string>
</dict></plist>
EOF
plutil -lint "$agent_file" >/dev/null
launchctl bootstrap "gui/$UID" "$agent_file"

healthy=0
for _ in {1..40}; do
  if curl --fail --silent "$local_origin/healthz" | grep -q '"status":"ok"'; then healthy=1; break; fi
  sleep 0.25
done
(( healthy )) || fail "the service did not become healthy; inspect ~/Library/Logs/Pi Station"
curl --fail --silent "$local_origin/workspace" >/dev/null
new_pi_pids=$(pgrep -f '/pi( |$)' 2>/dev/null | sort || true)
[[ "$new_pi_pids" == "$old_pi_pids" ]] || fail "a Pi process PID changed during installation"
release_switched=0
rm -rf -- "$rollback_dir"
rollback_dir=
trap - EXIT
printf 'Pi Station %s is installed.\nOpen %s/workspace\n' "$version" "$local_origin"
