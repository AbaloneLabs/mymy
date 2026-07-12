-- Bound repeated owner-PIN failures per network source. A single global
-- lockout lets any reachable client deny access to the legitimate owner, so
-- source identifiers are purpose-hashed by the API before storage.

CREATE TABLE IF NOT EXISTS auth_pin_source_failures (
    source_hash   TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_pin_source_failures_updated
    ON auth_pin_source_failures (updated_at);
