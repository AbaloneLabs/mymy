-- Chat sessions must be created for an explicit registered native agent.
--
-- Older migrations kept Hermes-era defaults so direct inserts could silently
-- create `default` sessions. The application now resolves or validates the
-- profile in the service layer and writes both fields explicitly.

ALTER TABLE chat_sessions ALTER COLUMN agent_id DROP DEFAULT;
ALTER TABLE chat_sessions ALTER COLUMN profile DROP DEFAULT;
