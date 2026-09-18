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
if ! node "$cli" await-host "$config" >/dev/null; then
  node "$cli" fail-start "$config" "$run_id"
  # Authenticated health must prove the empty kernel before stopping it.
  node "$cli" kernel-shutdown "$config" >/dev/null && wait "$kernel_pid" && {
    node "$cli" call "$config" close >/dev/null 2>&1 || true
    wait "$backend_pid" || true
    node "$cli" finalize "$config" 1 >/dev/null
  }
  exit 1
fi
if ! node "$cli" build-frontends "$config" >/dev/null; then
  node "$cli" fail-start "$config" "$run_id"
  node "$cli" kernel-shutdown "$config" >/dev/null && wait "$kernel_pid" &&
    node "$cli" call "$config" close >/dev/null && wait "$backend_pid" && node "$cli" finalize "$config" 1 >/dev/null
  exit 1
fi
source "$runtime/frontends.sh"
frontend_pids=()
for index in "${!FRONTEND_IDS[@]}"; do
  "$ELECTRON_BINARY" "${FRONTEND_ENTRIES[$index]}" "${FRONTEND_CONTEXTS[$index]}" >"$runtime/frontend-${FRONTEND_IDS[$index]}.stdout" 2>"$runtime/frontend-${FRONTEND_IDS[$index]}.stderr" &
  frontend_pids+=("$!")
done
if ! node "$cli" frontends "$config" health >/dev/null; then
  node "$cli" fail-start "$config" "$run_id"
  # No graph has been assembled/admitted. Terminate only our startup children.
  for pid in "${frontend_pids[@]}"; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  node "$cli" kernel-shutdown "$config" >/dev/null && wait "$kernel_pid" &&
    node "$cli" call "$config" close >/dev/null && wait "$backend_pid" && node "$cli" finalize "$config" 1 >/dev/null
  exit 1
fi
call() { node "$cli" call "$config" "$1"; }
kernel_stopped=no
close_run() {
  if [[ "$kernel_stopped" != yes ]]; then
  node "$cli" frontends "$config" gate >/dev/null &&
  call stop-business >/dev/null &&
  node "$cli" frontends "$config" stop-sources >/dev/null &&
  call evict >/dev/null &&
  node "$cli" kernel-shutdown "$config" >/dev/null &&
  wait "$kernel_pid" &&
  node "$cli" mark "$config" kernel-stopped >/dev/null || return
  kernel_stopped=yes
  fi
  node "$cli" frontends "$config" close >/dev/null &&
  wait_frontends &&
  call close >/dev/null &&
  wait "$backend_pid" &&
  node "$cli" finalize "$config" "${scenario_code:-0}" >/dev/null
}
wait_frontends() { for pid in "${frontend_pids[@]}"; do wait "$pid" || return; done; }
trap 'call request-stop >/dev/null' INT TERM HUP
startup_ok=yes
for stage in assemble admit initialize start; do
  if node "$cli" cancelled "$config"; then startup_ok=no; break; fi
  if ! call "$stage" >/dev/null; then startup_ok=no; break; fi
done
if [[ "$startup_ok" == yes ]]; then
  if node "$cli" frontends "$config" ready >/dev/null; then
    node "$cli" publish-start "$config" >/dev/null
  else startup_ok=no; fi
fi
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
  stop_receipt="$(call wait-stop)"
  if ! grep -q '"requested": true' <<<"$stop_receipt"; then continue; fi
  if close_run; then exit 0; fi
  node "$cli" fail-stop "$config" 'Graceful close failed; see supervisor.log; resources retained for retry' >/dev/null
done
