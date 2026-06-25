-- Version history — full-snapshot checkpoints for entities (notes, tasks).
--
-- Each row stores a complete JSONB snapshot of the entity at a checkpoint,
-- enabling point-in-time restore. Versions are created by the application
-- layer (not triggers) so we can control coalescing (5-min window) and
-- capture actor context (user vs agent).
--
-- Design notes:
--   * `entity_id` is UUID but NOT a FK: versions must survive soft
--     operations and remain queryable during restore. Cascade delete is
--     handled in application logic (delete_note clears its versions).
--   * `version_num` is per-entity, starting at 1. Restore allocates a NEW
--     version number (never reuses old ones).
--   * `snapshot` is JSONB: for notes { title, content, tags, pinned, projectId }.
--   * `snapshot_size` is the byte length of the snapshot text, used for
--     storage-management UI. Computed by the application at insert time.
--   * `actor_type` is 'user' by default; future AI agents will use 'agent'.

CREATE TABLE IF NOT EXISTS entity_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type    TEXT NOT NULL CHECK (entity_type IN ('note', 'task')),
    entity_id      UUID NOT NULL,
    version_num    INTEGER NOT NULL,
    -- Full snapshot of the entity state at this checkpoint.
    -- For notes: { title, content, tags, pinned, projectId }
    -- For tasks: { title, description, status, priority, dueDate, projectId }
    snapshot       JSONB NOT NULL,
    -- Who triggered the change that resulted in this version.
    actor_type     TEXT NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user', 'agent', 'system')),
    actor_label    TEXT,
    -- Human-readable summary for timeline display.
    -- e.g. "Note created", "Changed: content, tags", "Restored from v3"
    change_summary TEXT NOT NULL DEFAULT '',
    -- Size of the snapshot in bytes (for storage management UI).
    snapshot_size  INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (entity_type, entity_id, version_num)
);

-- Indexes
CREATE INDEX IF NOT EXISTS entity_versions_lookup_idx
    ON entity_versions (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS entity_versions_version_idx
    ON entity_versions (entity_type, entity_id, version_num DESC);
