-- 017_auth_pin_failures.sql — repeated PIN failure mitigation

CREATE TABLE IF NOT EXISTS auth_pin_failures (
    id            BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    failed_count  INTEGER NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ
);
