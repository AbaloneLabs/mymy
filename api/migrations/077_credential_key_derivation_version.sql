-- Existing encrypted provider credentials used the historical HKDF-derived
-- key. A successful owner login migrates them atomically to the Argon2id key;
-- new and rotated credentials are written as version 2 immediately.

ALTER TABLE llm_providers
    ADD COLUMN key_derivation_version SMALLINT NOT NULL DEFAULT 1
        CHECK (key_derivation_version IN (1, 2));

ALTER TABLE agent_credentials
    ADD COLUMN key_derivation_version SMALLINT NOT NULL DEFAULT 1
        CHECK (key_derivation_version IN (1, 2));
