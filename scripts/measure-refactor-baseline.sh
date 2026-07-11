#!/usr/bin/env bash
set -euo pipefail

# Measure representative refactor paths after compilation. Results include
# process startup and test-fixture setup, so compare only on the same machine
# and toolchain. RUNS controls repeated samples; the default favors a stable
# median without making local certification unnecessarily slow.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNS="${RUNS:-3}"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

if ! [[ "$RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "RUNS must be a positive integer" >&2
  exit 2
fi

measure() {
  local label="$1"
  local directory="$2"
  shift 2
  for iteration in $(seq 1 "$RUNS"); do
    local timing="$WORK_DIR/timing"
    local output="$WORK_DIR/output"
    if ! (cd "$directory" && /usr/bin/time -f '%e|%M' -o "$timing" "$@" >"$output" 2>&1); then
      cat "$output" >&2
      return 1
    fi
    IFS='|' read -r wall rss <"$timing"
    printf '%s|run=%s|wall_seconds=%s|max_rss_kb=%s\n' \
      "$label" "$iteration" "$wall" "$rss"
  done
}

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgres://mymy:mymy@localhost:33432/mymy"
fi

(cd "$ROOT_DIR/api" && cargo test --quiet --no-run)
(cd "$ROOT_DIR/web" && bun run build >/dev/null)

echo "mymy refactor performance baseline"
echo "runs=$RUNS"
measure content_admission "$ROOT_DIR/api" cargo test --quiet \
  suspicious_content_remains_outside_drive_until_reinspected_and_approved
measure editor_save "$ROOT_DIR/api" cargo test --quiet \
  lost_save_response_retries_without_a_second_commit
measure agent_turn "$ROOT_DIR/api" cargo test --quiet \
  loop_streams_text_and_finishes
measure editor_operations "$ROOT_DIR/web" bun run test -- \
  src/features/documentEditor/shared/operationHistory.test.ts
