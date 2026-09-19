#!/usr/bin/env bash
set -euo pipefail
run_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$run_dir/../.." && pwd)"
config="$run_dir/run.config.json"
exec bash "$repo_root/run.sh" start "$config" "$@"
