-- The message projection writer previously named a partial unique index as an
-- ON CONFLICT target without repeating its predicate. PostgreSQL rejected each
-- attempt before any chat message was inserted, and the durable outbox became
-- terminal after its bounded retries. Requeue only that explicit projection
-- failure class after the corrected writer is deployed; the projection key is
-- idempotent, so an interrupted migration or worker restart cannot duplicate a
-- message that was already committed.

UPDATE agent_run_message_outbox
SET status = 'pending',
    attempts = 0,
    last_error_code = NULL
WHERE status = 'failed'
  AND last_error_code = 'projection_apply_failed';
