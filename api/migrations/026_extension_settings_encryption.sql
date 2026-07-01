-- Encrypt secret-bearing extension settings at rest.
--
-- `settings` remains a redacted JSONB display copy. Runtime execution uses
-- `settings_encrypted` + `settings_nonce`, encrypted with the PIN-derived key.

ALTER TABLE extensions
    ADD COLUMN IF NOT EXISTS settings_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS settings_nonce TEXT;

UPDATE extensions
SET settings = jsonb_build_object('type', kind, 'redacted', true)
WHERE settings_encrypted IS NULL;
