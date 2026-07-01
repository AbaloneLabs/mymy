-- 020_knowledge_fix_article_parents.sql
--
-- Re-parent any knowledge node whose parent is NOT a category (folder).
--
-- Hierarchy rule enforced from now on (see validate_parent_is_category in
-- services/knowledge.rs): a node may only be nested under a category, or at
-- the root level (parent_id IS NULL). Articles are always leaf nodes.
--
-- Before this migration, the editor dropdown allowed any node (including
-- articles) to be selected as a parent, which made children disappear from
-- the tree UI. This migration walks the ancestor chain of each invalidly
-- parented node and re-points it at the nearest category ancestor, or to the
-- root (NULL) if no category ancestor exists.

-- Recursive CTE that walks the ancestor chain of each offending node until it
-- finds a category ancestor (the new valid parent) or reaches the root.
WITH RECURSIVE invalid_nodes AS (
    -- Seed: nodes whose direct parent is an article (the invalid case).
    -- `walk_id` tracks the current ancestor being inspected.
    SELECT
        c.id        AS node_id,
        p.id        AS walk_id,
        p.parent_id AS walk_parent,
        p.node_type AS walk_type,
        0           AS depth
    FROM knowledge_articles c
    JOIN knowledge_articles p ON p.id = c.parent_id
    WHERE p.node_type = 'article'
    UNION ALL
    -- Recurse up the chain: move to the current ancestor's parent.
    SELECT
        i.node_id,
        p.id        AS walk_id,
        p.parent_id AS walk_parent,
        p.node_type AS walk_type,
        i.depth + 1
    FROM invalid_nodes i
    JOIN knowledge_articles p ON p.id = i.walk_parent
    WHERE i.walk_type = 'article'   -- keep walking only through articles
      AND i.depth < 50              -- safety bound against pathological cycles
),
-- For each offending node, pick the nearest category ancestor. If the chain
-- contains no category (it ended at a root article), fall back to NULL.
resolved AS (
    SELECT DISTINCT ON (node_id)
        node_id,
        CASE
            WHEN walk_type = 'category' THEN walk_id
            ELSE walk_parent            -- NULL when the chain ended at root
        END AS new_parent
    FROM invalid_nodes
    WHERE walk_type = 'category' OR walk_parent IS NULL
    ORDER BY node_id, depth ASC
)
UPDATE knowledge_articles AS target
SET parent_id = resolved.new_parent,
    updated_at = now()
FROM resolved
WHERE target.id = resolved.node_id
  AND target.parent_id IS DISTINCT FROM resolved.new_parent;
