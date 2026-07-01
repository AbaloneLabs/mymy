-- Extend audit actions for security guardrail events.
--
-- Security denials are append-only audit records, not data mutations. Keeping
-- them in the same audit table lets the existing audit viewer show blocked
-- filesystem reads/writes without a parallel log pipeline.

ALTER TABLE audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_action_check
    CHECK (action IN ('create', 'update', 'delete', 'deny', 'redact'));
