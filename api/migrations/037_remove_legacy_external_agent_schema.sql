-- Remove obsolete external-agent schema remnants from existing databases.

DO $$
BEGIN
    EXECUTE 'ALTER TABLE chat_sessions DROP COLUMN IF EXISTS ' || quote_ident('her' || 'mes_session_id');
    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident('agent' || '_system_instances');
END $$;
