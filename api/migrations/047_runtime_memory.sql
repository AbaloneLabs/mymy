-- Run recap and provenance-aware durable memory. Search vectors are generated
-- locally by PostgreSQL; semantic vectors remain nullable and opt-in.

CREATE TABLE IF NOT EXISTS run_summaries (
    run_id              UUID PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_profile       TEXT NOT NULL,
    project_id          UUID,
    objective           TEXT NOT NULL,
    outcome             TEXT NOT NULL,
    files_touched       JSONB NOT NULL DEFAULT '[]'::jsonb,
    entities_changed    JSONB NOT NULL DEFAULT '[]'::jsonb,
    decisions           JSONB NOT NULL DEFAULT '[]'::jsonb,
    failures            JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_topics          TEXT[] NOT NULL DEFAULT '{}',
    source_event_start  BIGINT,
    source_event_end    BIGINT,
    summary_text        TEXT NOT NULL,
    search_tsv          TSVECTOR GENERATED ALWAYS AS
                        (to_tsvector('simple', objective || ' ' || summary_text)) STORED,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_summaries_search_idx
    ON run_summaries USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS run_summaries_scope_idx
    ON run_summaries(agent_profile, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_run_id       UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    source_decision_id  UUID REFERENCES decisions(id) ON DELETE SET NULL,
    source_message_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_snapshot     JSONB NOT NULL DEFAULT '{}'::jsonb,
    agent_profile       TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
    memory_type         TEXT NOT NULL CHECK (memory_type IN
                        ('preference', 'convention', 'decision', 'fact')),
    origin              TEXT NOT NULL CHECK (origin IN
                        ('explicit_user', 'agent_proposed', 'decision')),
    content             TEXT NOT NULL CHECK (length(btrim(content)) > 0),
    topic_key           TEXT NOT NULL,
    confidence          DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    status              TEXT NOT NULL DEFAULT 'pending_review'
                        CHECK (status IN ('pending_review', 'active', 'conflict',
                                         'stale', 'superseded', 'deleted')),
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until         TIMESTAMPTZ,
    superseded_by       UUID REFERENCES agent_memories(id) ON DELETE SET NULL,
    sensitivity         TEXT NOT NULL DEFAULT 'private'
                        CHECK (sensitivity IN ('normal', 'private', 'financial')),
    search_tsv          TSVECTOR GENERATED ALWAYS AS
                        (to_tsvector('simple', content)) STORED,
    embedding           vector(384),
    embedding_provider  TEXT,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_memories_search_idx
    ON agent_memories USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS agent_memories_scope_idx
    ON agent_memories(agent_profile, project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_memories_topic_idx
    ON agent_memories(agent_profile, project_id, memory_type, topic_key);
