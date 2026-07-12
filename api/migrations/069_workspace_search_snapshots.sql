-- Federated search continuation stores a bounded authorized result ordering
-- server-side. The opaque cursor carries only a snapshot id, random bearer
-- token, and offset; query text is represented by a one-way binding hash.

CREATE TABLE workspace_search_snapshots (
    id UUID PRIMARY KEY,
    token_hash TEXT NOT NULL,
    principal_key TEXT NOT NULL,
    permission_fingerprint TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    scope TEXT NOT NULL,
    hits JSONB NOT NULL,
    partial_failures JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(hits) = 'array'),
    CHECK (jsonb_array_length(hits) <= 400),
    CHECK (jsonb_typeof(partial_failures) = 'array')
);

CREATE INDEX workspace_search_snapshots_expiry_idx
    ON workspace_search_snapshots(expires_at);
