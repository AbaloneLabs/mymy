-- Add project association to knowledge articles.
--
-- Mirrors the notes.project_id pattern: NULL means the node belongs to no
-- project (shown only when the project filter is "All Projects"). Root nodes
-- carry the project_id; children inherit visibility through the tree fetch.
--
-- Only root nodes (parent_id IS NULL) store the project_id directly. When a
-- project filter is active, the tree query filters root nodes by project_id
-- and their descendants are included automatically via the adjacency-list
-- walk, so a whole subtree stays together.

ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Index for filtering root nodes by project.
CREATE INDEX IF NOT EXISTS ka_project_idx ON knowledge_articles(project_id);
