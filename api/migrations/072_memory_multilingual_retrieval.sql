-- PostgreSQL simple dictionaries do not provide adequate partial matching for
-- Korean/CJK text without whitespace. Local trigram candidates supplement FTS
-- while retaining the same scope and lifecycle predicates.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX agent_memories_content_trgm_idx
    ON agent_memories USING GIN (lower(content) gin_trgm_ops)
    WHERE status <> 'deleted';
