-- Knowledge Base / Wiki — hierarchical documents (categories + articles).
--
-- Single-table adjacency-list tree: parent_id self-reference allows an
-- arbitrary nesting depth. node_type discriminates 'category' (folder) from
-- 'article' (document). FTS tsvector is auto-maintained by a trigger,
-- mirroring the notes pattern (007_notes.sql).

CREATE TABLE IF NOT EXISTS knowledge_articles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Hierarchical structure: NULL = root-level node.
    parent_id    UUID REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    -- Node type: 'category' (folder) or 'article' (document).
    node_type    TEXT NOT NULL DEFAULT 'article'
                 CHECK (node_type IN ('category', 'article')),
    -- Content
    title        TEXT NOT NULL,
    slug         TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',   -- markdown (empty for categories)
    excerpt      TEXT NOT NULL DEFAULT '',   -- short summary for list views
    tags         TEXT[] NOT NULL DEFAULT '{}',
    -- Workflow
    status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published')),
    sort_order   INTEGER NOT NULL DEFAULT 0,
    -- Full-text search vector, auto-maintained via trigger.
    search_tsv   TSVECTOR,
    -- Timestamps
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Constraints
    CONSTRAINT ka_title_nonempty CHECK (length(btrim(title)) > 0),
    CONSTRAINT ka_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Unique slug within the same parent (null parent = root level).
-- COALESCE collapses NULL parent_id to a sentinel so root-level slugs are
-- also enforced unique among themselves.
CREATE UNIQUE INDEX IF NOT EXISTS ka_slug_parent_uniq
    ON knowledge_articles (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

-- FTS index
CREATE INDEX IF NOT EXISTS ka_search_idx ON knowledge_articles USING GIN(search_tsv);
-- Hierarchy & filtering indexes
CREATE INDEX IF NOT EXISTS ka_parent_idx ON knowledge_articles(parent_id);
CREATE INDEX IF NOT EXISTS ka_status_idx ON knowledge_articles(status);
CREATE INDEX IF NOT EXISTS ka_node_type_idx ON knowledge_articles(node_type);
CREATE INDEX IF NOT EXISTS ka_updated_idx ON knowledge_articles(updated_at DESC);

-- Auto-maintain search_tsv from title + content (simple config for multilingual
-- support incl. CJK; English stemming harms non-English text. weights A=title, B=content).
CREATE OR REPLACE FUNCTION knowledge_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.content, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS knowledge_search_tsv_trigger ON knowledge_articles;
CREATE TRIGGER knowledge_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF title, content ON knowledge_articles
    FOR EACH ROW EXECUTE FUNCTION knowledge_search_tsv_update();
