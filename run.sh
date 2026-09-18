#!/usr/bin/env bash
# Unified named-run entry: start / stop / status against an explicit config.
# Bash only orchestrates processes, stages and cleanup; it never executes
# business change logic or assumes business persistence.
#
# start: validates, takes the same-name lock, boots the kernel, assembles the
#   real slice, injects lifecycle Infos, and waits for the ready barrier, all
#   inside a background supervisor (`cli.mjs _run`). Bash polls the run
#   snapshot for the `started` stage, then returns while the supervisor stays
#   alive owning the kernel/worker/provider. stop/status read the snapshot.
#
# Windows note: Node on Windows terminates on SIGTERM without running JS
# handlers, so stop does NOT signal the supervisor. Instead stop runs the
# full supervised close in the stop process itself (stop Infos, settle,
# evict, daemon shutdown via the run token), then terminates the orphaned
# supervisor, which exits once its kernel child is gone.
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
cli="$repo_root/packages/tooling/run/src/cli.mjs"

run_root="$(cd "$(dirname "$config")" && pwd)"
run_name="$(basename "$run_root")"
runtime_dir="$run_root/.generated/runtime"
snapshot="$runtime_dir/config-snapshot.json"
supervisor_log="$run_root/.generated/logs/supervisor.log"

abs_config() {
  case "$config" in
    /*|?:/*|?:\\*) printf '%s' "$config" ;;
    *) printf '%s/%s' "$repo_root" "$config" ;;
  esac
}

case "$op" in
  status)
    exec node "$cli" status "$(abs_config)"
    ;;
  stop)
    exec node "$cli" stop "$(abs_config)"
    ;;
  start)
    if [[ -f "$runtime_dir/run.lock.json" ]]; then
      echo "Run is already active: $run_name" >&2
      exit 1
    fi
    mkdir -p "$(dirname "$supervisor_log")" "$runtime_dir"
    # Launch the supervisor detached: it owns kernel/worker/provider until stop.
    # Supervisor stdout (the started JSON) is discarded; readiness is polled
    # from the snapshot below. Logs go to the supervisor log.
    nohup node "$cli" _run "$(abs_config)" >>"$supervisor_log" 2>&1 &
    supervisor_pid=$!
    # Poll the snapshot for the `started` stage (default 60s).
    deadline=$((SECONDS + 60))
    started=""
    while [[ $SECONDS -lt $deadline ]]; do
      if [[ -f "$snapshot" ]] && grep -q '"started"' "$snapshot" 2>/dev/null; then
        started="yes"
        break
      fi
      if ! kill -0 "$supervisor_pid" 2>/dev/null; then
        echo "run supervisor exited before start completed; see $supervisor_log" >&2
        tail -n 20 "$supervisor_log" >&2 || true
        exit 1
      fi
      sleep 1
    done
    if [[ -z "$started" ]]; then
      echo "run start timed out waiting for the started stage; see $supervisor_log" >&2
      exit 1
    fi
    # Emit the snapshot's started record on stdout (JSON for callers/tests).
    node -e "
import('node:fs').then((fs) => {
  const snapshot = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  console.log(JSON.stringify({ started: true, runName: snapshot.runName, pid: snapshot.pid, configPath: snapshot.configPath, kernel: snapshot.kernel, stages: snapshot.stages }, null, 2));
});
" "$snapshot"
    ;;
esac
