#!/bin/bash
set -u

command=${1:?tool command is required}
child=

stop_tree() {
  local parent=$1 descendants
  descendants=$(pgrep -P "$parent" 2>/dev/null || true)
  for descendant in $descendants; do stop_tree "$descendant"; done
  kill -TERM "$parent" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  [[ -z ${child:-} ]] || stop_tree "$child"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

/bin/bash -lc "$command" &
child=$!
wait "$child"
status=$?
child=
exit "$status"
