CREATE TABLE IF NOT EXISTS document_editor_save_receipts (
    idempotency_key TEXT PRIMARY KEY,
    drive_path TEXT NOT NULL,
    editor_kind TEXT NOT NULL,
    expected_fingerprint TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_content_hash TEXT NOT NULL,
    result_fingerprint TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'committed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(idempotency_key) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS document_editor_save_receipts_created_idx
    ON document_editor_save_receipts(created_at DESC);
