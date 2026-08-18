#!/bin/bash
set -u

unit=${1:?transient unit name is required}
owner_pid=${2:?owner PID is required}
owner_start=${3:?owner start time is required}
payload=${4:?payload path is required}
marker=${payload}.complete

cleanup() {
  rm -f -- "$payload" "$marker"
}
trap cleanup EXIT

mapfile -d '' -t payload_parts < "$payload"
rm -f -- "$payload"
if (( ${#payload_parts[@]} < 2 )); then
  echo "Pi Station tool payload is incomplete" >&2
  exit 125
fi
command=${payload_parts[0]}
env_args=("${payload_parts[@]:1}")

owner_is_alive() {
  [[ -r /proc/$owner_pid/stat ]] || return 1
  [[ $(awk '{print $22}' "/proc/$owner_pid/stat" 2>/dev/null) == "$owner_start" ]]
}

watch_owner() {
  while [[ ! -e $marker ]]; do
    if ! owner_is_alive; then
      systemctl --user stop "$unit" >/dev/null 2>&1 || true
      return
    fi
    sleep 0.1
  done
}
watch_owner &
watcher=$!

/usr/bin/env -i "${env_args[@]}" /bin/bash -c "$command"
status=$?
touch "$marker"
wait "$watcher" || true
exit "$status"
