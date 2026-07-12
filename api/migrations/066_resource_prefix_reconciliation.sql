-- Directory moves use one durable prefix fence/event instead of emitting an
-- unbounded synchronous effect for every descendant.

ALTER TABLE resource_operations
    ADD COLUMN directory_move_pending BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX resource_operations_directory_move_idx
    ON resource_operations(updated_at, id)
    WHERE operation_kind = 'move' AND directory_move_pending;

CREATE INDEX agent_file_observations_resource_idx
    ON agent_file_observations(agent_profile, resource_id, updated_at DESC)
    WHERE resource_id IS NOT NULL;

CREATE INDEX document_revision_events_resource_fingerprint_idx
    ON document_revision_events(resource_id, fingerprint, created_at DESC)
    WHERE resource_id IS NOT NULL;

CREATE INDEX document_revision_snapshots_resource_hash_idx
    ON document_revision_snapshots(resource_id, content_hash, last_used_at DESC)
    WHERE resource_id IS NOT NULL;
