-- Knowledge article restore support has used the shared version service since
-- it was introduced, but the original table constraint still reflected the
-- earlier note/task-only design. Keep the database admission policy aligned
-- with the application validator so creation, edits, and restore checkpoints
-- cannot silently lose their audit history.

ALTER TABLE entity_versions
    DROP CONSTRAINT entity_versions_entity_type_check;

ALTER TABLE entity_versions
    ADD CONSTRAINT entity_versions_entity_type_check
    CHECK (entity_type IN ('note', 'task', 'knowledge_article'));
