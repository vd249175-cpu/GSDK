#!/usr/bin/env bash
# Bash exclusively orders kernel, topology, Info and host lifecycle.
set -euo pipefail
config="$1"
run_id="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cli="$repo_root/packages/tooling/run/src/cli.mjs"
runtime="$(dirname "$config")/.generated/runtime"
if ! node "$cli" prepare "$config" "$run_id" >/dev/null; then
  node "$cli" fail-start "$config" "$run_id"
  exit 1
fi
# Only generated, shell-quoted export assignments are sourced.
source "$runtime/environment.sh"
"$KERNEL_BINARY" >"$runtime/kernel.stdout" 2>"$runtime/kernel.stderr" &
kernel_pid=$!
if ! node "$cli" kernel-ready "$config" >/dev/null; then
  node "$cli" fail-start "$config" "$run_id"
  # Owned child has never admitted a Node: no business teardown exists yet.
  kill "$kernel_pid" 2>/dev/null || true
  wait "$kernel_pid" 2>/dev/null || true
  node "$cli" finalize "$config" 1 >/dev/null
  exit 1
fi
node "$cli" backend "$config" &
backend_pid=$!
node "$cli" await-host "$config" >/dev/null
call() { node "$cli" call "$config" "$1"; }
close_run() {
  call stop-business >/dev/null &&
  call evict >/dev/null &&
  node "$cli" kernel-shutdown "$config" >/dev/null &&
  wait "$kernel_pid" &&
  node "$cli" mark "$config" kernel-stopped >/dev/null &&
  call close >/dev/null &&
  wait "$backend_pid" &&
  node "$cli" finalize "$config" "${scenario_code:-0}" >/dev/null
}
trap 'call request-stop >/dev/null' INT TERM HUP
startup_ok=yes
for stage in assemble admit initialize start; do
  if node "$cli" cancelled "$config"; then startup_ok=no; break; fi
  if ! call "$stage" >/dev/null; then startup_ok=no; break; fi
done
scenario_code=0
if [[ "$startup_ok" != yes ]]; then
  node "$cli" fail-start "$config" "$run_id"
  if close_run; then exit 1; fi
  node "$cli" fail-stop "$config" 'Startup rollback failed; resources retained for retry' >/dev/null
elif grep -q '"scenario": true' "$runtime/start-result.json"; then
  scenario_result="$(call scenario)"
  if grep -q '"exitCode": 1' <<<"$scenario_result"; then scenario_code=1; fi
  if close_run; then exit "$scenario_code"; fi
  node "$cli" fail-stop "$config" 'Scenario cleanup failed; resources retained for retry' >/dev/null
fi
while true; do
  call wait-stop >/dev/null
  if close_run; then exit 0; fi
  node "$cli" fail-stop "$config" 'Graceful close failed; see supervisor.log; resources retained for retry' >/dev/null
done
