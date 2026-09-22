#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 2 ]] || { echo 'Usage: bash ./run.sh start|stop|status|validate|analyze|inspect runs/<name>/run.config.json [json]; bash ./run.sh pack <capability-dir> [out.zip]; bash ./run.sh verify <capability.zip> [--expect-sha256 <hex>]; bash ./run.sh install <capability.zip> [--dir <dir>] [--run <run.config.json>] [--update] [--expect-sha256 <hex>]' >&2; exit 2; }
op="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="$(cd "$(dirname "$2")" && pwd)"
config="$config_dir/$(basename "$2")"
cli="$repo_root/packages/tooling/run/src/cli.mjs"
case "$op" in
  pack|verify|install|pack-base|install-base|pack-run|install-run) exec node "$cli" "$op" "$2" "${3:-}" "${4:-}" "${5:-}" "${6:-}" ;;
  stop|status|validate|analyze|inspect) exec node "$cli" "$op" "$config" "${3:-}" ;;
  start)
    node "$cli" validate "$config" >/dev/null
    runtime="$config_dir/.generated/runtime"
    if [[ -f "$runtime/run.lock.json" ]]; then
      status_json="$(node "$cli" status "$config" 2>/dev/null || true)"
      if grep -q '"cleanupRequired": true' <<<"$status_json" || grep -q '"state": "unreachable"' <<<"$status_json"; then
        echo "Auto-cleaning stale lock from inactive run..." >&2
        node "$cli" stop "$config" >/dev/null 2>&1 || true
      fi
    fi
    [[ ! -f "$runtime/run.lock.json" ]] || { echo 'Run is already active' >&2; exit 1; }
    mkdir -p "$runtime" "$config_dir/.generated/logs"
    run_id="$(node "$cli" id)"
    nohup bash "$repo_root/packages/tooling/run/supervisor.sh" "$config" "$run_id" >>"$config_dir/.generated/logs/supervisor.log" 2>&1 & disown 2>/dev/null || true
    trap 'node "$cli" stop "$config" >&2; exit 130' INT TERM HUP
    node "$cli" await-start "$config" "$run_id"
    trap - INT TERM HUP
    ;;
  *) echo 'Unknown run operation' >&2; exit 2 ;;
esac
