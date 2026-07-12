-- Persist enough non-content intent to recover a resource projection after a
-- process crash, and fence session-scoped editor saves during chat deletion.

ALTER TABLE resource_operations
    ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS reconcile_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (reconcile_attempts >= 0),
    ADD COLUMN IF NOT EXISTS reconcile_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS reconcile_lease_owner TEXT,
    ADD COLUMN IF NOT EXISTS reconcile_lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS resource_operations_worker_idx
    ON resource_operations(reconcile_after, created_at, id)
    WHERE state IN ('prepared', 'filesystem_committed', 'reconciling');

ALTER TABLE document_editor_save_receipts
    ADD COLUMN IF NOT EXISTS source_session_id UUID
        REFERENCES chat_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS document_editor_save_receipts_session_pending_idx
    ON document_editor_save_receipts(source_session_id, updated_at)
    WHERE status = 'pending' AND source_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_resources_drive_identity_unique
    ON knowledge_resources(knowledge_id, drive_resource_id)
    WHERE drive_resource_id IS NOT NULL;
