-- Wiki nodes reference Drive files without duplicating document storage.

CREATE TABLE IF NOT EXISTS knowledge_resources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_id        UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    resource_type       TEXT NOT NULL DEFAULT 'drive_file'
                        CHECK (resource_type IN ('drive_file')),
    resource_ref        TEXT NOT NULL CHECK (resource_ref ~ '^/drive(/|$)'),
    title               TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'linked'
                        CHECK (status IN ('linked', 'broken')),
    broken_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (knowledge_id, resource_type, resource_ref)
);

CREATE INDEX IF NOT EXISTS knowledge_resources_knowledge_idx
    ON knowledge_resources(knowledge_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS knowledge_resources_ref_idx
    ON knowledge_resources(resource_type, resource_ref);
