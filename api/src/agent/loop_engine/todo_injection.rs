use std::path::Path;

use serde::Deserialize;

use crate::agent::security::redact_sensitive_text;

#[derive(Debug, Deserialize)]
struct TodoInjectionItem {
    id: String,
    content: String,
    status: String,
}

pub(super) fn load_todo_injection(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let todos = serde_json::from_str::<Vec<TodoInjectionItem>>(&raw).ok()?;
    if todos.is_empty() {
        return None;
    }
    let mut out = String::from(
        "[Runtime context after compression]\nCurrent task list retained from todo tool:\n",
    );
    for todo in todos.into_iter().take(256) {
        let status = match todo.status.as_str() {
            "completed" => "[x]",
            "in_progress" => "[~]",
            "cancelled" => "[-]",
            _ => "[ ]",
        };
        out.push_str(&format!(
            "- {status} {} - {}\n",
            redact_sensitive_text(todo.id.trim()),
            redact_sensitive_text(todo.content.trim())
        ));
    }
    Some(out)
}
