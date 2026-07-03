-- Durable Drive trash metadata.
--
-- Files are still moved on the local Drive filesystem immediately, but the
-- original logical path is persisted so the UI can list, restore, or
-- permanently purge deleted entries without guessing from timestamped names.

CREATE TABLE IF NOT EXISTS drive_trash_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_path TEXT NOT NULL,
    trash_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('directory', 'file')),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    restored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS drive_trash_entries_deleted_idx
    ON drive_trash_entries(deleted_at DESC)
    WHERE restored_at IS NULL;
