use std::fs;
use std::path::{Path, PathBuf};

use crate::agent::memory::{ENTRY_DELIMITER, MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT};
use crate::error::{AppError, AppResult};

use super::{map_io, modified_at, JourneyNode, JourneyNodeType};

pub(super) fn memory_nodes(memory_root: &Path) -> AppResult<Vec<JourneyNode>> {
    let mut nodes = Vec::new();
    for (source, file_name) in [("memory", "MEMORY.md"), ("user", "USER.md")] {
        let path = memory_root.join(file_name);
        let entries = read_memory_entries(&path)?;
        let timestamp = modified_at(&path);
        for (index, entry) in entries.into_iter().enumerate() {
            nodes.push(JourneyNode {
                id: format!("memory:{source}:{index}"),
                node_type: JourneyNodeType::Memory,
                title: memory_title(&entry),
                description: String::new(),
                content: entry,
                category: Some(source.to_string()),
                source: source.to_string(),
                path: Some(file_name.to_string()),
                timestamp: timestamp.clone(),
                use_count: 0,
                state: "active".to_string(),
                pinned: false,
                related: Vec::new(),
            });
        }
    }
    Ok(nodes)
}

pub(super) fn remove_memory_entry(memory_root: &Path, source: &str, index: usize) -> AppResult<()> {
    let path = memory_path(memory_root, source)?;
    let mut entries = read_memory_entries(&path)?;
    if index >= entries.len() {
        return Err(AppError::NotFound("memory node not found".to_string()));
    }
    entries.remove(index);
    write_memory_entries(&path, source, &entries)
}

pub(super) fn replace_memory_entry(
    memory_root: &Path,
    source: &str,
    index: usize,
    content: &str,
) -> AppResult<()> {
    let entry = content.trim().replace("\r\n", "\n");
    if entry.is_empty() {
        return Err(AppError::BadRequest(
            "memory content cannot be empty".to_string(),
        ));
    }
    let path = memory_path(memory_root, source)?;
    let mut entries = read_memory_entries(&path)?;
    if index >= entries.len() {
        return Err(AppError::NotFound("memory node not found".to_string()));
    }
    entries[index] = entry;
    write_memory_entries(&path, source, &entries)
}

fn memory_path(memory_root: &Path, source: &str) -> AppResult<PathBuf> {
    match source {
        "memory" => Ok(memory_root.join("MEMORY.md")),
        "user" => Ok(memory_root.join("USER.md")),
        _ => Err(AppError::BadRequest("invalid memory source".to_string())),
    }
}

fn read_memory_entries(path: &Path) -> AppResult<Vec<String>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|err| map_io("memory read failed", err))?;
    Ok(raw
        .split(ENTRY_DELIMITER)
        .map(|entry| entry.trim().replace("\r\n", "\n"))
        .filter(|entry| !entry.is_empty())
        .collect())
}

fn write_memory_entries(path: &Path, source: &str, entries: &[String]) -> AppResult<()> {
    let serialized = entries.join(ENTRY_DELIMITER);
    let limit = match source {
        "memory" => MEMORY_CHAR_LIMIT,
        "user" => USER_CHAR_LIMIT,
        _ => return Err(AppError::BadRequest("invalid memory source".to_string())),
    };
    if serialized.chars().count() > limit {
        return Err(AppError::BadRequest(
            "memory content exceeds limit".to_string(),
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| map_io("memory mkdir failed", err))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, serialized).map_err(|err| map_io("memory write failed", err))?;
    fs::rename(&tmp, path).map_err(|err| map_io("memory move failed", err))?;
    Ok(())
}

fn memory_title(content: &str) -> String {
    let first_line = content.lines().next().unwrap_or_default().trim();
    let title = if first_line.is_empty() {
        content.trim()
    } else {
        first_line
    };
    let truncated = title.chars().take(80).collect::<String>();
    if title.chars().count() > 80 {
        format!("{truncated}...")
    } else {
        truncated
    }
}
