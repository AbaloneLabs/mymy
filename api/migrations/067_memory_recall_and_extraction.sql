-- Automatic bounded recall, explicit memory ownership, and resumable
-- conversation extraction. Existing rows remain profile/project scoped; no
-- ambiguous legacy row is widened to user-global visibility.

ALTER TABLE agent_memories
    DROP CONSTRAINT IF EXISTS agent_memories_memory_type_check,
    DROP CONSTRAINT IF EXISTS agent_memories_origin_check;

ALTER TABLE agent_memories
    ADD CONSTRAINT agent_memories_memory_type_check CHECK (memory_type IN
        ('preference', 'convention', 'decision', 'fact', 'temporal')),
    ADD CONSTRAINT agent_memories_origin_check CHECK (origin IN
        ('explicit_user', 'agent_proposed', 'decision', 'conversation_inferred')),
    ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'agent_profile'
        CHECK (scope_kind IN ('user_global', 'agent_profile', 'project', 'session')),
    ADD COLUMN scope_id TEXT,
    ADD COLUMN tier TEXT NOT NULL DEFAULT 'durable'
        CHECK (tier IN ('working', 'durable', 'curated')),
    ADD COLUMN evidence_role TEXT NOT NULL DEFAULT 'user_asserted'
        CHECK (evidence_role IN ('user_asserted', 'agent_observed_from_durable_result',
                                 'external_source_claim', 'system_inferred')),
    ADD COLUMN source_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    ADD COLUMN source_message_start UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    ADD COLUMN source_message_end UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    ADD COLUMN extraction_batch_id UUID,
    ADD COLUMN content_revision BIGINT NOT NULL DEFAULT 1 CHECK (content_revision > 0),
    ADD COLUMN lifecycle_revision BIGINT NOT NULL DEFAULT 1 CHECK (lifecycle_revision > 0),
    ADD COLUMN last_confirmed_at TIMESTAMPTZ,
    ADD COLUMN last_recalled_at TIMESTAMPTZ,
    ADD COLUMN recall_count BIGINT NOT NULL DEFAULT 0 CHECK (recall_count >= 0);

UPDATE agent_memories
SET scope_kind = CASE WHEN project_id IS NULL THEN 'agent_profile' ELSE 'project' END,
    scope_id = COALESCE(project_id::text, agent_profile)
WHERE scope_id IS NULL;

ALTER TABLE agent_memories
    ADD CONSTRAINT agent_memories_scope_identity_check CHECK (
        (scope_kind = 'user_global' AND scope_id IS NULL) OR
        (scope_kind <> 'user_global' AND scope_id IS NOT NULL)
    ) NOT VALID;

CREATE INDEX agent_memories_recall_scope_idx
    ON agent_memories(agent_profile, scope_kind, scope_id, status, valid_until, created_at DESC);
CREATE INDEX agent_memories_source_session_idx
    ON agent_memories(source_session_id)
    WHERE source_session_id IS NOT NULL;

CREATE TABLE memory_runtime_settings (
    agent_profile TEXT PRIMARY KEY REFERENCES native_agents(profile) ON DELETE CASCADE,
    automatic_recall_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    inferred_extraction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    semantic_indexing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    settings_revision BIGINT NOT NULL DEFAULT 1 CHECK (settings_revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memory_extraction_cursors (
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    agent_profile TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    last_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    last_message_created_at TIMESTAMPTZ,
    conversation_revision BIGINT NOT NULL DEFAULT 1 CHECK (conversation_revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, agent_profile)
);

CREATE TABLE memory_extraction_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    agent_profile TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    first_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    last_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    conversation_revision BIGINT NOT NULL,
    extractor_version TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    settings_revision BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN
        ('queued', 'processing', 'shadow_complete', 'committed', 'skipped', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, agent_profile, first_message_id, last_message_id,
            conversation_revision, extractor_version, policy_version)
);

CREATE INDEX memory_extraction_batches_work_idx
    ON memory_extraction_batches(state, next_attempt_at, created_at)
    WHERE state IN ('queued', 'processing', 'failed');

ALTER TABLE agent_memories
    ADD CONSTRAINT agent_memories_extraction_batch_fk
    FOREIGN KEY (extraction_batch_id) REFERENCES memory_extraction_batches(id) ON DELETE SET NULL;

CREATE TABLE run_memory_context_manifests (
    run_id UUID PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    manifest_version TEXT NOT NULL,
    permission_scope_hash TEXT NOT NULL,
    settings_revision BIGINT NOT NULL,
    search_mode TEXT NOT NULL,
    selected_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    requested_count INTEGER NOT NULL DEFAULT 0 CHECK (requested_count >= 0),
    selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
    dropped_count INTEGER NOT NULL DEFAULT 0 CHECK (dropped_count >= 0),
    estimated_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_tokens >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
