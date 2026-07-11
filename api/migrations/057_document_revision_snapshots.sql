CREATE TABLE document_revision_snapshots (
    drive_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    content_bytes BYTEA NOT NULL,
    content_size BIGINT NOT NULL CHECK (content_size >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (drive_path, content_hash)
);

CREATE INDEX document_revision_snapshots_retention_idx
    ON document_revision_snapshots (drive_path, last_used_at DESC);
