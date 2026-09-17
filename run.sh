#!/usr/bin/env bash
# Unified named-run entry: start / stop / status against an explicit config.
# Bash only orchestrates processes, stages and cleanup; it never executes
# business change logic or assumes business persistence.
set -euo pipefail

usage() {
  echo "Usage: bash ./run.sh start|stop|status runs/<name>/run.config.json" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
op="$1"
config="$2"

case "$op" in
  start|stop|status) ;;
  *) usage ;;
esac

if [[ ! -f "$config" ]]; then
  echo "run config not found: $config" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$repo_root/packages/tooling/run/src/cli.mjs" "$op" "$config"
