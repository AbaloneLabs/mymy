-- Fresh and legacy-default installations must remain locked until an owner
-- supplies an explicit secret. Existing non-default installations keep their
-- current credential and durable owner data unchanged.

ALTER TABLE app_meta
    ADD COLUMN bootstrap_required BOOLEAN NOT NULL DEFAULT FALSE;
