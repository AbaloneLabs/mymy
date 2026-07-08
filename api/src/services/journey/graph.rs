use std::collections::{BTreeMap, BTreeSet, VecDeque};

use chrono::{DateTime, Utc};

use super::{JourneyEdge, JourneyNode, JourneyNodeType};

pub(super) fn related_edges(nodes: &[JourneyNode]) -> Vec<JourneyEdge> {
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

pub(super) fn neighborhood(node_id: &str, edges: &[JourneyEdge]) -> BTreeSet<String> {
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

pub(super) fn sort_nodes(nodes: &mut [JourneyNode], sort: Option<&str>) {
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

fn parse_timestamp(value: &Option<String>) -> Option<DateTime<Utc>> {
    value
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
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
