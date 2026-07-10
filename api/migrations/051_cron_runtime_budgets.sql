-- Autonomous scheduler runs must always carry finite work budgets. Backfilling
-- legacy empty objects keeps old jobs safe without changing their schedule or
-- approval policy.

ALTER TABLE cron_jobs
    ALTER COLUMN budget SET DEFAULT
        '{"maxToolCalls": 100, "maxRuntimeSeconds": 1800}'::jsonb;

UPDATE cron_jobs
SET budget = jsonb_build_object(
        'maxToolCalls', COALESCE(
            NULLIF(budget->>'maxToolCalls', '')::integer,
            100
        ),
        'maxRuntimeSeconds', COALESCE(
            NULLIF(budget->>'maxRuntimeSeconds', '')::integer,
            1800
        )
    )
WHERE NOT (budget ? 'maxToolCalls')
   OR NOT (budget ? 'maxRuntimeSeconds');

ALTER TABLE cron_jobs DROP CONSTRAINT IF EXISTS cron_jobs_budget_shape_check;
ALTER TABLE cron_jobs ADD CONSTRAINT cron_jobs_budget_shape_check CHECK (
    jsonb_typeof(budget) = 'object'
    AND jsonb_typeof(budget->'maxToolCalls') = 'number'
    AND jsonb_typeof(budget->'maxRuntimeSeconds') = 'number'
    AND (budget->>'maxToolCalls')::integer BETWEEN 1 AND 1000
    AND (budget->>'maxRuntimeSeconds')::integer BETWEEN 1 AND 86400
);
