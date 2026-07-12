-- Extraction retries may resume after some candidates committed. A batch/topic
-- key makes those retries idempotent without treating text equality across
-- unrelated conversations as the same evidence.

CREATE UNIQUE INDEX agent_memories_extraction_batch_topic_unique
    ON agent_memories(extraction_batch_id, topic_key)
    WHERE extraction_batch_id IS NOT NULL;

ALTER TABLE memory_extraction_batches
    ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
    ADD COLUMN committed_count INTEGER NOT NULL DEFAULT 0 CHECK (committed_count >= 0),
    ADD COLUMN completed_at TIMESTAMPTZ;
