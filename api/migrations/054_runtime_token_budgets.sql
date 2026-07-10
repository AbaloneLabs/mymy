-- Token budgets complement tool/time limits for autonomous and delegated
-- model work. Child reservations can then be bounded by the parent's total
-- allowance instead of multiplying it by fan-out.

ALTER TABLE cron_jobs
    ALTER COLUMN budget SET DEFAULT
        '{"maxToolCalls": 100, "maxRuntimeSeconds": 1800, "maxTotalTokens": 200000}'::jsonb;

UPDATE cron_jobs
SET budget = budget || jsonb_build_object('maxTotalTokens', 200000)
WHERE NOT (budget ? 'maxTotalTokens');

ALTER TABLE cron_jobs DROP CONSTRAINT IF EXISTS cron_jobs_budget_shape_check;
ALTER TABLE cron_jobs ADD CONSTRAINT cron_jobs_budget_shape_check CHECK (
    jsonb_typeof(budget) = 'object'
    AND jsonb_typeof(budget->'maxToolCalls') = 'number'
    AND jsonb_typeof(budget->'maxRuntimeSeconds') = 'number'
    AND jsonb_typeof(budget->'maxTotalTokens') = 'number'
    AND (budget->>'maxToolCalls')::integer BETWEEN 1 AND 1000
    AND (budget->>'maxRuntimeSeconds')::integer BETWEEN 1 AND 86400
    AND (budget->>'maxTotalTokens')::integer BETWEEN 1000 AND 2000000
);

ALTER TABLE proactive_settings
    ADD COLUMN IF NOT EXISTS max_total_tokens INTEGER NOT NULL DEFAULT 50000
        CHECK (max_total_tokens BETWEEN 1000 AND 1000000);
