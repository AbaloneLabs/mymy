-- Preserve the distinction between an invisible quarantined candidate and an
-- already-visible trusted revision at the same logical Drive path.
ALTER TABLE content_quarantine_items
    ADD COLUMN target_fingerprint TEXT;
