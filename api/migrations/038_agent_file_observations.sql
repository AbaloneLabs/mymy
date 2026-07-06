-- Track the file versions each agent has actually observed through file tools.
-- This lets the runtime block stale writes after a user edits the same file
-- from the UI, forcing the agent to re-read before making another mutation.

CREATE TABLE IF NOT EXISTS agent_file_observations (
    agent_profile TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    last_seen_hash TEXT NOT NULL,
    last_seen_size BIGINT NOT NULL,
    last_seen_modified_at TIMESTAMPTZ,
    last_seen_source TEXT NOT NULL
        CHECK (last_seen_source IN ('read', 'write')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_profile, logical_path)
);

CREATE INDEX IF NOT EXISTS idx_agent_file_observations_updated_at
    ON agent_file_observations(updated_at DESC);
