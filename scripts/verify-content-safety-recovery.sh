#!/usr/bin/env bash
set -euo pipefail

# Rehearse the additive 059 -> 061 upgrade and a matched metadata/private-byte
# restore in an isolated PostgreSQL container. Nothing from the developer's
# configured database or Drive root is read or modified.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
CONTAINER="mymy-content-recovery-$RANDOM-$$"
SOURCE_PRIVATE="$WORK_DIR/source-private"
RESTORED_PRIVATE="$WORK_DIR/restored-private"
STORAGE_KEY="11111111-1111-4111-8111-111111111111"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$SOURCE_PRIVATE" "$RESTORED_PRIVATE"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=mymy \
  -e POSTGRES_DB=source \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$ROOT_DIR/api/migrations:/migrations:ro" \
  -v "$WORK_DIR:/rehearsal" \
  pgvector/pgvector:pg16 >/dev/null

READY_COUNT=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U mymy -d source -tAc 'SELECT 1' >/dev/null 2>&1; then
    READY_COUNT=$((READY_COUNT + 1))
    if [ "$READY_COUNT" -ge 3 ]; then
      break
    fi
  else
    READY_COUNT=0
  fi
  sleep 1
done
test "$READY_COUNT" -ge 3

docker exec "$CONTAINER" bash -lc '
  set -euo pipefail
  for migration in /migrations/*.sql; do
    name="$(basename "$migration")"
    if [[ "$name" < "060_" ]]; then
      psql -v ON_ERROR_STOP=1 -U mymy -d source -f "$migration" >/dev/null
    fi
  done
'

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mymy -d source -c \
  "INSERT INTO drive_sync_jobs (provider, drive_path, operation, status) VALUES ('s3', '/drive/existing-before-upgrade', 'download', 'done')" \
  >/dev/null

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mymy -d source \
  -f /migrations/060_content_quarantine.sql >/dev/null
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mymy -d source \
  -f /migrations/061_quarantine_target_revision.sql >/dev/null

UPGRADED="$(docker exec "$CONTAINER" psql -U mymy -d source -tAc \
  "SELECT status || ':' || COALESCE(quarantine_id::text, 'none') FROM drive_sync_jobs WHERE drive_path = '/drive/existing-before-upgrade'")"
test "$UPGRADED" = "done:none"

printf '%s' 'quarantined recovery rehearsal bytes' >"$SOURCE_PRIVATE/$STORAGE_KEY"
chmod 600 "$SOURCE_PRIVATE/$STORAGE_KEY"
SHA256="$(sha256sum "$SOURCE_PRIVATE/$STORAGE_KEY" | awk '{print $1}')"
SIZE="$(wc -c <"$SOURCE_PRIVATE/$STORAGE_KEY" | tr -d ' ')"

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mymy -d source -c \
  "INSERT INTO content_quarantine_items
     (desired_path, normalized_name, detected_type, origin_kind, actor_kind,
      sha256, size, storage_key, findings, policy_version, expires_at)
   VALUES
     ('/drive/recovery-rehearsal.bin', 'recovery-rehearsal.bin',
      'application/octet-stream', 'agent_download', 'agent', '$SHA256', $SIZE,
      '$STORAGE_KEY', '[]'::jsonb, 'mymy-native-1', now() + interval '1 day')" \
  >/dev/null

docker exec "$CONTAINER" pg_dump -U mymy -d source --data-only --inserts \
  --table=content_quarantine_items --table=drive_sync_jobs \
  --file=/rehearsal/metadata.sql
tar -C "$SOURCE_PRIVATE" -cf "$WORK_DIR/private.tar" .

docker exec "$CONTAINER" createdb -U mymy restored
docker exec "$CONTAINER" bash -lc '
  set -euo pipefail
  for migration in /migrations/*.sql; do
    psql -v ON_ERROR_STOP=1 -U mymy -d restored -f "$migration" >/dev/null
  done
  psql -v ON_ERROR_STOP=1 -U mymy -d restored -f /rehearsal/metadata.sql >/dev/null
'
tar -C "$RESTORED_PRIVATE" -xf "$WORK_DIR/private.tar"

RESTORED_ROW="$(docker exec "$CONTAINER" psql -U mymy -d restored -tAc \
  "SELECT sha256 || ':' || size::text || ':' || status FROM content_quarantine_items WHERE storage_key = '$STORAGE_KEY'")"
test "$RESTORED_ROW" = "$SHA256:$SIZE:pending"
cmp "$SOURCE_PRIVATE/$STORAGE_KEY" "$RESTORED_PRIVATE/$STORAGE_KEY"
test "$(stat -c '%a' "$RESTORED_PRIVATE/$STORAGE_KEY")" = "600"

echo "Content-safety migration and matched backup/restore rehearsal passed."
