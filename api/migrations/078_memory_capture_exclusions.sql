-- Source-bound negative capture fences prevent delayed extraction jobs from
-- turning an explicitly excluded user message into derived memory. The table
-- stores no message content and follows the source session/message lifecycle.

CREATE TABLE memory_capture_exclusions (
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    agent_profile TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    source_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    source_message_created_at TIMESTAMPTZ NOT NULL,
    reason_code TEXT NOT NULL CHECK (reason_code IN ('user_negative_capture')),
    policy_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, agent_profile, source_message_id)
);

CREATE INDEX memory_capture_exclusions_source_idx
    ON memory_capture_exclusions(agent_profile, source_message_created_at, source_message_id);
