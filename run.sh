#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 2 ]] || { echo 'Usage: bash ./run.sh start|stop|status|analyze|inspect runs/<name>/run.config.json [json]' >&2; exit 2; }
op="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="$(cd "$(dirname "$2")" && pwd)"
config="$config_dir/$(basename "$2")"
cli="$repo_root/packages/tooling/run/src/cli.mjs"
case "$op" in
  stop|status|analyze|inspect) exec node "$cli" "$op" "$config" "${3:-}" ;;
  start)
    node "$cli" validate "$config" >/dev/null
    runtime="$config_dir/.generated/runtime"
    [[ ! -f "$runtime/run.lock.json" ]] || { echo 'Run is already active' >&2; exit 1; }
    mkdir -p "$runtime" "$config_dir/.generated/logs"
    run_id="$(node "$cli" id)"
    nohup bash "$repo_root/packages/tooling/run/supervisor.sh" "$config" "$run_id" >>"$config_dir/.generated/logs/supervisor.log" 2>&1 &
    trap 'node "$cli" stop "$config" >&2; exit 130' INT TERM HUP
    node "$cli" await-start "$config" "$run_id"
    ;;
  *) echo 'Unknown run operation' >&2; exit 2 ;;
esac
