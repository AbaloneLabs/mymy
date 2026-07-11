ALTER TABLE document_revision_snapshots
    ADD COLUMN IF NOT EXISTS pinned_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS document_revision_snapshots_pin_idx
    ON document_revision_snapshots (drive_path, pinned_until)
    WHERE pinned_until IS NOT NULL;
