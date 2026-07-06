-- Remove orphan chat sessions.
--
-- The `default` profile is now reserved and cannot map to a native agent.
-- Leaving these rows visible made the UI re-enter an invalid agent scope.

DELETE FROM chat_sessions WHERE profile = 'default';
