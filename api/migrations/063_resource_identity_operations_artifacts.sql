-- Stable Drive identity, recoverable mutation receipts, Run effects, and
-- curated chat artifacts. Paths remain compatibility projections during the
-- rollout and never become foreign identities.

CREATE TABLE drive_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
    provider TEXT NOT NULL DEFAULT 'local_vm',
    lifecycle_state TEXT NOT NULL
        CHECK (lifecycle_state IN ('active', 'trashed', 'purged', 'missing', 'reconciling')),
    current_path TEXT,
    canonical_path TEXT,
    current_revision BIGINT NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    lifecycle_revision BIGINT NOT NULL DEFAULT 0 CHECK (lifecycle_revision >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    purged_at TIMESTAMPTZ,
    CHECK ((lifecycle_state = 'active') = (current_path IS NOT NULL AND canonical_path IS NOT NULL))
        NOT VALID
);

CREATE UNIQUE INDEX drive_resources_active_path_unique
    ON drive_resources(provider, canonical_path)
    WHERE lifecycle_state = 'active';

CREATE INDEX drive_resources_reconciliation_idx
    ON drive_resources(lifecycle_state, updated_at, id);

CREATE TABLE resource_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_kind TEXT NOT NULL,
    resource_id UUID NOT NULL REFERENCES drive_resources(id),
    revision BIGINT NOT NULL CHECK (revision > 0),
    fingerprint TEXT NOT NULL,
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    source TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    actor_id TEXT,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (resource_id, revision)
);

CREATE TABLE resource_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    operation_kind TEXT NOT NULL,
    resource_id UUID REFERENCES drive_resources(id),
    before_reference TEXT,
    requested_reference TEXT,
    committed_reference TEXT,
    expected_revision TEXT,
    committed_revision TEXT,
    state TEXT NOT NULL CHECK (state IN (
        'prepared', 'filesystem_committed', 'projected', 'sync_pending',
        'completed', 'conflict', 'reconciling', 'compensation_required', 'failed'
    )),
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX resource_operations_reconcile_idx
    ON resource_operations(state, updated_at, id)
    WHERE state NOT IN ('completed', 'conflict', 'failed');

CREATE TABLE resource_outbox (
    id BIGSERIAL PRIMARY KEY,
    operation_id UUID NOT NULL REFERENCES resource_operations(id),
    resource_id UUID NOT NULL REFERENCES drive_resources(id),
    resource_sequence BIGINT NOT NULL,
    event_kind TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    UNIQUE (resource_id, resource_sequence, event_kind)
);

CREATE TABLE run_resource_effects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    invocation_id TEXT,
    agent_profile TEXT,
    parent_run_id UUID,
    operation_id UUID REFERENCES resource_operations(id),
    resource_kind TEXT NOT NULL,
    resource_id UUID NOT NULL REFERENCES drive_resources(id),
    effect_kind TEXT NOT NULL CHECK (effect_kind IN (
        'created', 'updated', 'moved', 'trashed', 'restored', 'purged',
        'attached', 'detached', 'exported', 'read'
    )),
    before_reference TEXT,
    after_reference TEXT,
    observed_revision TEXT,
    resource_sequence BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX run_resource_effects_dedupe_idx
    ON run_resource_effects(
        COALESCE(run_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(invocation_id, ''), effect_kind, resource_id, observed_revision
    );

CREATE TABLE artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    origin_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    source_effect_id UUID REFERENCES run_resource_effects(id) ON DELETE SET NULL,
    resource_id UUID NOT NULL UNIQUE REFERENCES drive_resources(id),
    artifact_type TEXT NOT NULL,
    title TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    lifecycle_sequence BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE session_artifact_links (
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    artifact_id UUID NOT NULL REFERENCES artifacts(id),
    relationship_kind TEXT NOT NULL CHECK (relationship_kind IN ('created', 'modified', 'deleted', 'restored')),
    first_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    last_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    first_effect_id UUID REFERENCES run_resource_effects(id) ON DELETE SET NULL,
    last_effect_id UUID REFERENCES run_resource_effects(id) ON DELETE SET NULL,
    first_linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, artifact_id)
);

CREATE INDEX session_artifact_links_activity_idx
    ON session_artifact_links(session_id, last_activity_at DESC, artifact_id);

ALTER TABLE drive_trash_entries
    ADD COLUMN resource_id UUID REFERENCES drive_resources(id),
    ADD COLUMN operation_id UUID REFERENCES resource_operations(id),
    ADD COLUMN purged_at TIMESTAMPTZ;

ALTER TABLE document_revision_events
    ADD COLUMN resource_id UUID REFERENCES drive_resources(id);

ALTER TABLE document_revision_snapshots
    ADD COLUMN resource_id UUID REFERENCES drive_resources(id);

ALTER TABLE agent_file_observations
    ADD COLUMN resource_id UUID REFERENCES drive_resources(id);

ALTER TABLE knowledge_resources
    ADD COLUMN drive_resource_id UUID REFERENCES drive_resources(id);

ALTER TABLE content_quarantine_items
    ADD COLUMN target_resource_id UUID REFERENCES drive_resources(id);

ALTER TABLE drive_sync_jobs
    ADD COLUMN resource_id UUID REFERENCES drive_resources(id),
    ADD COLUMN resource_sequence BIGINT;
