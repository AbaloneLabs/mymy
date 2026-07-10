use std::collections::HashMap;

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::{KnowledgeResource, KnowledgeTreeNode};

use super::repository::{row_to_article, KnowledgeArticleRow};

pub(super) fn build_tree(
    rows: Vec<KnowledgeArticleRow>,
    project_filter: Option<Option<Uuid>>,
) -> Vec<KnowledgeTreeNode> {
    let mut nodes: HashMap<Uuid, KnowledgeTreeNode> = HashMap::new();
    let mut root_ids: Vec<Uuid> = Vec::new();
    let mut child_map: HashMap<Option<Uuid>, Vec<Uuid>> = HashMap::new();

    for row in rows {
        let id = row.id;
        let parent = row.parent_id;
        let project = row.project_id;
        let is_root = parent.is_none();
        child_map.entry(parent).or_default().push(id);
        if is_root {
            let keep = match project_filter {
                None => true,
                Some(None) => project.is_none(),
                Some(Some(pid)) => project == Some(pid),
            };
            if keep {
                root_ids.push(id);
            }
        }
        nodes.insert(
            id,
            KnowledgeTreeNode {
                article: row_to_article(row),
                children: Vec::new(),
                resources: Vec::new(),
            },
        );
    }

    for rid in &root_ids {
        attach_children(*rid, &mut nodes, &child_map);
    }

    root_ids.iter().filter_map(|id| nodes.remove(id)).collect()
}

pub(super) fn parse_project_filter(raw: Option<&str>) -> AppResult<Option<Option<Uuid>>> {
    match raw {
        None => Ok(None),
        Some("null") | Some("") => Ok(Some(None)),
        Some(pid) => {
            let uuid = Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?;
            Ok(Some(Some(uuid)))
        }
    }
}

pub(super) fn attach_resources(
    nodes: &mut [KnowledgeTreeNode],
    resources: &mut HashMap<Uuid, Vec<KnowledgeResource>>,
) {
    for node in nodes {
        if let Ok(id) = Uuid::parse_str(&node.article.id) {
            node.resources = resources.remove(&id).unwrap_or_default();
        }
        attach_resources(&mut node.children, resources);
    }
}

fn attach_children(
    node_id: Uuid,
    nodes: &mut HashMap<Uuid, KnowledgeTreeNode>,
    child_map: &HashMap<Option<Uuid>, Vec<Uuid>>,
) {
    let children_ids = match child_map.get(&Some(node_id)) {
        Some(ids) => ids.clone(),
        None => return,
    };
    for cid in &children_ids {
        attach_children(*cid, nodes, child_map);
    }
    let built: Vec<KnowledgeTreeNode> = children_ids
        .iter()
        .filter_map(|cid| nodes.remove(cid))
        .collect();
    if let Some(node) = nodes.get_mut(&node_id) {
        node.children = built;
    }
}
