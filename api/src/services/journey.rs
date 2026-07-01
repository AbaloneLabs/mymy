//! Journey graph for learned skills and memories.
//!
//! The graph is derived from local agent data on demand. This keeps the view
//! consistent with the runtime without introducing a denormalized database
//! table that could drift from `SKILL.md`, `.usage.json`, or memory files.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::agent::memory::{ENTRY_DELIMITER, MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT};
use crate::agent::skills::SkillRegistry;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct JourneyQuery {
    #[serde(rename = "type")]
    pub node_type: Option<String>,
    pub sort: Option<String>,
    pub neighborhood: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JourneyResponse {
    pub nodes: Vec<JourneyNode>,
    pub edges: Vec<JourneyEdge>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJourneyNodeRequest {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JourneyMutationResponse {
    pub success: bool,
    pub node_id: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JourneyNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: JourneyNodeType,
    pub title: String,
    pub description: String,
    pub content: String,
    pub category: Option<String>,
    pub source: String,
    pub path: Option<String>,
    pub timestamp: Option<String>,
    pub use_count: u64,
    pub state: String,
    pub pinned: bool,
    pub related: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JourneyNodeType {
    Skill,
    Memory,
}

#[derive(Debug, Clone, Serialize)]
pub struct JourneyEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Deserialize, Default)]
struct SkillUsageRecord {
    #[serde(default)]
    use_count: u64,
    #[serde(default)]
    last_used_at: Option<String>,
    #[serde(default)]
    last_viewed_at: Option<String>,
    #[serde(default)]
    last_patched_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default, alias = "related")]
    related_skills: Vec<String>,
    #[serde(default)]
    created_by: Option<String>,
}

pub async fn get_journey(state: &AppState, query: JourneyQuery) -> AppResult<JourneyResponse> {
    let root = state.config.agent_data_dir.join("skills");
    let mut nodes = skill_nodes(&root)?;
    nodes.extend(memory_nodes(&state.config.agent_data_dir.join("memory"))?);
    let mut edges = related_edges(&nodes);

    if let Some(node_id) = query
        .neighborhood
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let keep = neighborhood(node_id, &edges);
        nodes.retain(|node| keep.contains(&node.id));
        edges.retain(|edge| keep.contains(&edge.source) && keep.contains(&edge.target));
    }

    if let Some(node_type) = query.node_type.as_deref() {
        let filter = match node_type {
            "skill" | "skills" => Some(JourneyNodeType::Skill),
            "memory" | "memories" => Some(JourneyNodeType::Memory),
            _ => None,
        };
        if let Some(filter) = filter {
            nodes.retain(|node| node.node_type == filter);
            let keep = nodes
                .iter()
                .map(|node| node.id.clone())
                .collect::<BTreeSet<_>>();
            edges.retain(|edge| keep.contains(&edge.source) && keep.contains(&edge.target));
        }
    }

    sort_nodes(&mut nodes, query.sort.as_deref());
    let total = nodes.len();
    Ok(JourneyResponse {
        nodes,
        edges,
        total,
    })
}

pub async fn delete_node(state: &AppState, node_id: &str) -> AppResult<JourneyMutationResponse> {
    match parse_node_id(node_id)? {
        JourneyTarget::Skill { name } => {
            SkillRegistry::new(state.config.agent_data_dir.join("skills"))
                .delete(name, true)
                .map_err(|err| map_io("skill archive failed", err))?;
            Ok(JourneyMutationResponse {
                success: true,
                node_id: node_id.to_string(),
                action: "archive".to_string(),
            })
        }
        JourneyTarget::Memory { source, index } => {
            remove_memory_entry(&state.config.agent_data_dir.join("memory"), source, index)?;
            Ok(JourneyMutationResponse {
                success: true,
                node_id: node_id.to_string(),
                action: "delete".to_string(),
            })
        }
    }
}

pub async fn update_node(
    state: &AppState,
    node_id: &str,
    req: UpdateJourneyNodeRequest,
) -> AppResult<JourneyMutationResponse> {
    match parse_node_id(node_id)? {
        JourneyTarget::Skill { name } => {
            let registry = SkillRegistry::new(state.config.agent_data_dir.join("skills"));
            let mut actions = Vec::new();
            if let Some(content) = req.content {
                registry
                    .replace_content(name, &content)
                    .map_err(|err| map_io("skill update failed", err))?;
                actions.push("update");
            }
            if let Some(pinned) = req.pinned {
                registry
                    .set_pinned(name, pinned)
                    .map_err(|err| map_io("skill pin failed", err))?;
                actions.push(if pinned { "pin" } else { "unpin" });
            }
            if actions.is_empty() {
                return Err(AppError::BadRequest(
                    "journey update requires content or pinned".to_string(),
                ));
            }
            Ok(JourneyMutationResponse {
                success: true,
                node_id: node_id.to_string(),
                action: actions.join(","),
            })
        }
        JourneyTarget::Memory { source, index } => {
            let Some(content) = req.content else {
                return Err(AppError::BadRequest(
                    "memory update requires content".to_string(),
                ));
            };
            replace_memory_entry(
                &state.config.agent_data_dir.join("memory"),
                source,
                index,
                &content,
            )?;
            Ok(JourneyMutationResponse {
                success: true,
                node_id: node_id.to_string(),
                action: "update".to_string(),
            })
        }
    }
}

fn skill_nodes(root: &Path) -> AppResult<Vec<JourneyNode>> {
    let registry = SkillRegistry::new(root.to_path_buf());
    let usage = load_usage(root)?;
    let pins = load_pins(root)?;
    let mut nodes = Vec::new();

    for skill in registry
        .list(None)
        .map_err(|err| map_io("skill list failed", err))?
    {
        let skill_md = root.join(&skill.path);
        let related = parse_skill_frontmatter(&skill_md)?
            .map(|frontmatter| frontmatter.related_skills)
            .unwrap_or_default();
        let usage_record = usage.get(&skill.name);
        nodes.push(JourneyNode {
            id: format!("skill:{}", skill.name),
            node_type: JourneyNodeType::Skill,
            title: skill.name.clone(),
            description: skill.description,
            content: String::new(),
            category: skill.category,
            source: "profile".to_string(),
            path: Some(skill.path),
            timestamp: usage_record
                .and_then(latest_usage_timestamp)
                .or_else(|| modified_at(&skill_md)),
            use_count: usage_record.map(|record| record.use_count).unwrap_or(0),
            state: "active".to_string(),
            pinned: pins.contains(&skill.name),
            related,
        });
    }

    nodes.extend(archived_skill_nodes(root, &usage, &pins)?);
    Ok(nodes)
}

enum JourneyTarget<'a> {
    Skill { name: &'a str },
    Memory { source: &'a str, index: usize },
}

fn parse_node_id(node_id: &str) -> AppResult<JourneyTarget<'_>> {
    if let Some(rest) = node_id.strip_prefix("skill:") {
        let Some((name, _archived)) = rest.split_once(":archived:") else {
            return Ok(JourneyTarget::Skill { name: rest });
        };
        return Err(AppError::BadRequest(format!(
            "archived skill nodes cannot be mutated: {name}"
        )));
    }
    if let Some(rest) = node_id.strip_prefix("memory:") {
        let (source, index) = rest
            .split_once(':')
            .ok_or_else(|| AppError::BadRequest("invalid memory node id".to_string()))?;
        if !matches!(source, "memory" | "user") {
            return Err(AppError::BadRequest("invalid memory source".to_string()));
        }
        let index = index
            .parse::<usize>()
            .map_err(|_| AppError::BadRequest("invalid memory index".to_string()))?;
        return Ok(JourneyTarget::Memory { source, index });
    }
    Err(AppError::BadRequest("invalid journey node id".to_string()))
}

fn remove_memory_entry(memory_root: &Path, source: &str, index: usize) -> AppResult<()> {
    let path = memory_path(memory_root, source)?;
    let mut entries = read_memory_entries(&path)?;
    if index >= entries.len() {
        return Err(AppError::NotFound("memory node not found".to_string()));
    }
    entries.remove(index);
    write_memory_entries(&path, source, &entries)
}

fn replace_memory_entry(
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

fn archived_skill_nodes(
    root: &Path,
    usage: &BTreeMap<String, SkillUsageRecord>,
    pins: &BTreeSet<String>,
) -> AppResult<Vec<JourneyNode>> {
    let archive_root = root.join(".archive");
    if !archive_root.exists() {
        return Ok(Vec::new());
    }
    let mut nodes = Vec::new();
    for entry in fs::read_dir(&archive_root).map_err(|err| map_io("archive read failed", err))? {
        let entry = entry.map_err(|err| map_io("archive entry failed", err))?;
        let skill_md = entry.path().join("SKILL.md");
        let Some(frontmatter) = parse_skill_frontmatter(&skill_md)? else {
            continue;
        };
        let rel_path = relative_display(root, &skill_md);
        let usage_record = usage.get(&frontmatter.name);
        nodes.push(JourneyNode {
            id: format!(
                "skill:{}:archived:{}",
                frontmatter.name,
                entry.file_name().to_string_lossy()
            ),
            node_type: JourneyNodeType::Skill,
            title: frontmatter.name.clone(),
            description: frontmatter.description,
            content: String::new(),
            category: Some(".archive".to_string()),
            source: frontmatter
                .created_by
                .unwrap_or_else(|| "profile".to_string()),
            path: Some(rel_path),
            timestamp: usage_record
                .and_then(latest_usage_timestamp)
                .or_else(|| modified_at(&skill_md)),
            use_count: usage_record.map(|record| record.use_count).unwrap_or(0),
            state: "archived".to_string(),
            pinned: pins.contains(&frontmatter.name),
            related: frontmatter.related_skills,
        });
    }
    Ok(nodes)
}

fn memory_nodes(memory_root: &Path) -> AppResult<Vec<JourneyNode>> {
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

fn related_edges(nodes: &[JourneyNode]) -> Vec<JourneyEdge> {
    let active_skill_ids = nodes
        .iter()
        .filter(|node| node.node_type == JourneyNodeType::Skill && node.state == "active")
        .map(|node| (slugify(&node.title), node.id.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut edges = Vec::new();
    for node in nodes
        .iter()
        .filter(|node| node.node_type == JourneyNodeType::Skill && node.state == "active")
    {
        for related in &node.related {
            if let Some(target) = active_skill_ids.get(&slugify(related)) {
                edges.push(JourneyEdge {
                    source: node.id.clone(),
                    target: target.clone(),
                });
            }
        }
    }
    edges.sort_by(|a, b| (&a.source, &a.target).cmp(&(&b.source, &b.target)));
    edges.dedup_by(|a, b| a.source == b.source && a.target == b.target);
    edges
}

fn neighborhood(node_id: &str, edges: &[JourneyEdge]) -> BTreeSet<String> {
    let mut graph = BTreeMap::<String, Vec<String>>::new();
    for edge in edges {
        graph
            .entry(edge.source.clone())
            .or_default()
            .push(edge.target.clone());
        graph
            .entry(edge.target.clone())
            .or_default()
            .push(edge.source.clone());
    }
    let mut keep = BTreeSet::new();
    let mut queue = VecDeque::from([node_id.to_string()]);
    while let Some(current) = queue.pop_front() {
        if !keep.insert(current.clone()) {
            continue;
        }
        if let Some(next) = graph.get(&current) {
            queue.extend(next.iter().cloned());
        }
    }
    keep
}

fn sort_nodes(nodes: &mut [JourneyNode], sort: Option<&str>) {
    match sort.unwrap_or("recent") {
        "usage" => nodes.sort_by(|a, b| {
            b.use_count
                .cmp(&a.use_count)
                .then_with(|| a.title.cmp(&b.title))
        }),
        "name" => nodes.sort_by(|a, b| a.title.cmp(&b.title)),
        _ => nodes.sort_by(|a, b| {
            parse_timestamp(&b.timestamp)
                .cmp(&parse_timestamp(&a.timestamp))
                .then_with(|| a.title.cmp(&b.title))
        }),
    }
}

fn load_usage(root: &Path) -> AppResult<BTreeMap<String, SkillUsageRecord>> {
    let path = root.join(".usage.json");
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = fs::read_to_string(&path).map_err(|err| map_io("skill usage read failed", err))?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn load_pins(root: &Path) -> AppResult<BTreeSet<String>> {
    let path = root.join(".pinned.json");
    if !path.exists() {
        return Ok(BTreeSet::new());
    }
    let raw = fs::read_to_string(&path).map_err(|err| map_io("skill pins read failed", err))?;
    Ok(serde_json::from_str::<Vec<String>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .collect())
}

fn parse_skill_frontmatter(path: &Path) -> AppResult<Option<SkillFrontmatter>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw =
        fs::read_to_string(path).map_err(|err| map_io("skill frontmatter read failed", err))?;
    let Some(rest) = raw.strip_prefix("---\n") else {
        return Ok(None);
    };
    let Some((yaml, _body)) = rest.split_once("\n---") else {
        return Ok(None);
    };
    serde_yaml::from_str::<SkillFrontmatter>(yaml)
        .map(Some)
        .map_err(|err| AppError::BadRequest(format!("invalid skill frontmatter: {err}")))
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

fn latest_usage_timestamp(record: &SkillUsageRecord) -> Option<String> {
    [
        record.last_patched_at.as_deref(),
        record.last_used_at.as_deref(),
        record.last_viewed_at.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| DateTime::parse_from_rfc3339(value).ok())
    .map(|value| value.with_timezone(&Utc))
    .max()
    .map(|value| value.to_rfc3339())
}

fn modified_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .map(|value| value.to_rfc3339())
}

fn parse_timestamp(value: &Option<String>) -> Option<DateTime<Utc>> {
    value
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
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

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .to_string()
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if matches!(ch, '-' | '_' | ' ' | '/') && !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn map_io(context: &str, err: io::Error) -> AppError {
    let message = format!("{context}: {err}");
    match err.kind() {
        io::ErrorKind::InvalidData
        | io::ErrorKind::InvalidInput
        | io::ErrorKind::PermissionDenied => AppError::BadRequest(message),
        io::ErrorKind::NotFound => AppError::NotFound(message),
        _ => AppError::Internal(message),
    }
}
