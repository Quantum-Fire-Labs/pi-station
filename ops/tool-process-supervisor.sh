#!/bin/bash
set -u

unit=${1:?transient unit name is required}
shift
command=${1:?tool command is required}
started=0
payload=

cleanup() {
  trap - EXIT
  if (( started )); then
    systemctl --user stop "$unit" >/dev/null 2>&1 || true
    systemctl --user reset-failed "$unit" >/dev/null 2>&1 || true
  fi
  [[ -z $payload ]] || rm -f -- "$payload" "${payload}.complete"
}
trap cleanup EXIT

if ! command -v systemd-run >/dev/null || ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "Pi Station cannot isolate this tool: the systemd user manager is unavailable" >&2
  exit 125
fi

runner=$(dirname -- "$0")/tool-process-runner.sh
payload=$(mktemp "${XDG_RUNTIME_DIR:-/tmp}/pi-station-tool.XXXXXX") || exit 125
chmod 600 "$payload"
{
  printf '%s\0' "$command"
  while IFS= read -r -d '' entry; do printf '%s\0' "$entry"; done < /proc/$$/environ
} > "$payload"
owner_start=$(awk '{print $22}' "/proc/$$/stat")

started=1
systemd-run --user \
  --unit="$unit" \
  --collect \
  --wait \
  --pipe \
  --property=Type=exec \
  --property=KillMode=control-group \
  --property=RemainAfterExit=no \
  --same-dir \
  -- "$runner" "$unit" "$$" "$owner_start" "$payload"
status=$?
cleanup
exit "$status"
