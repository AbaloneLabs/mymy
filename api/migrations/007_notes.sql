-- Notes / wiki with full-text search + pgvector embedding (nullable, for future RAG).
-- pgvector extension is already enabled by migration 001.

CREATE TABLE IF NOT EXISTS notes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    tags         TEXT[] NOT NULL DEFAULT '{}',
    -- Full-text search vector, auto-maintained via trigger.
    search_tsv   TSVECTOR,
    -- pgvector embedding (nullable until an embedding model is wired up).
    embedding    VECTOR(1024),
    pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notes_title_nonempty CHECK (length(btrim(title)) > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS notes_project_idx ON notes(project_id);
CREATE INDEX IF NOT EXISTS notes_pinned_idx ON notes(pinned) WHERE pinned = TRUE;
CREATE INDEX IF NOT EXISTS notes_created_idx ON notes(created_at DESC);
CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING GIN(search_tsv);
-- ivfflat index for future semantic search; harmless while embeddings are NULL.
CREATE INDEX IF NOT EXISTS notes_embedding_idx ON notes USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- Auto-maintain the search_tsv from title + content (simple config for multilingual
-- support incl. CJK; English stemming harms non-English text. weights A=title, B=content).
CREATE OR REPLACE FUNCTION notes_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.content, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_search_tsv_trigger ON notes;
CREATE TRIGGER notes_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF title, content ON notes
    FOR EACH ROW EXECUTE FUNCTION notes_search_tsv_update();
