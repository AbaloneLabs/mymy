use crate::models::knowledge::KnowledgeArticle;
use crate::models::note::Note;

/// Build a JSONB snapshot of a note's editable state.
pub fn note_to_snapshot(note: &Note) -> serde_json::Value {
    serde_json::json!({
        "title": note.title,
        "content": note.content,
        "tags": note.tags,
        "pinned": note.pinned,
        "projectId": note.project_id,
    })
}

/// Build a JSONB snapshot of a knowledge article's editable state.
pub fn knowledge_article_to_snapshot(article: &KnowledgeArticle) -> serde_json::Value {
    serde_json::json!({
        "title": article.title,
        "slug": article.slug,
        "content": article.content,
        "excerpt": article.excerpt,
        "tags": article.tags,
        "status": article.status,
        "nodeType": article.node_type,
        "parentId": article.parent_id,
        "projectId": article.project_id,
        "sortOrder": article.sort_order,
    })
}

/// Compare two note states and produce a human-readable change summary
/// (e.g. "Changed: title, tags").
pub fn compute_note_change_summary(old: &Note, new: &Note) -> String {
    let mut changes = Vec::new();
    if old.title != new.title {
        changes.push("title");
    }
    if old.content != new.content {
        changes.push("content");
    }
    if old.tags != new.tags {
        changes.push("tags");
    }
    if old.pinned != new.pinned {
        changes.push("pinned");
    }
    if changes.is_empty() {
        "No changes".to_string()
    } else {
        format!("Changed: {}", changes.join(", "))
    }
}

/// Compare two knowledge article states and produce a human-readable change
/// summary.
pub fn compute_knowledge_article_change_summary(
    old: &KnowledgeArticle,
    new: &KnowledgeArticle,
) -> String {
    let mut changes = Vec::new();
    if old.title != new.title {
        changes.push("title");
    }
    if old.content != new.content {
        changes.push("content");
    }
    if old.tags != new.tags {
        changes.push("tags");
    }
    if old.slug != new.slug {
        changes.push("slug");
    }
    if old.excerpt != new.excerpt {
        changes.push("excerpt");
    }
    if old.status != new.status {
        changes.push("status");
    }
    if old.node_type != new.node_type {
        changes.push("nodeType");
    }
    if old.parent_id != new.parent_id {
        changes.push("parentId");
    }
    if changes.is_empty() {
        "No changes".to_string()
    } else {
        format!("Changed: {}", changes.join(", "))
    }
}
