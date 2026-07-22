-- Write-safety verdicts are enforcement evidence, not chat timeline content.
-- Reclassify rows created before event producers made visibility explicit so
-- replaying an existing run follows the same projection contract as new runs.
UPDATE agent_run_events
SET visibility = 'audit'
WHERE event_type = 'write_safety_inspected'
  AND visibility = 'user';
