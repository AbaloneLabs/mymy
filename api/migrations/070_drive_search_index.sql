-- Drive discovery is indexed by stable resource identity. The index is a
-- projection only: every result joins and revalidates the authoritative
-- lifecycle/path row before it can be returned.

CREATE TABLE drive_search_documents (
    resource_id UUID PRIMARY KEY REFERENCES drive_resources(id) ON DELETE CASCADE,
    resource_sequence BIGINT NOT NULL CHECK (resource_sequence >= 0),
    mime_type TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '',
    extraction_status TEXT NOT NULL CHECK (extraction_status IN (
        'content', 'metadata_only', 'unsupported', 'failed'
    )),
    extractor_version TEXT NOT NULL,
    content_policy_version TEXT NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_tsv TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', content_text)
    ) STORED
);

CREATE INDEX drive_search_documents_tsv_idx
    ON drive_search_documents USING GIN(search_tsv);

CREATE TABLE resource_outbox_deliveries (
    consumer TEXT NOT NULL,
    outbox_id BIGINT NOT NULL REFERENCES resource_outbox(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, outbox_id)
);
