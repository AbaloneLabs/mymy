//! Deterministic fusion of keyword and semantic memory rankings.

use std::collections::HashMap;

use uuid::Uuid;

use super::MemoryRow;

pub(super) fn reciprocal_rank_fusion(
    keyword: Vec<MemoryRow>,
    semantic: Vec<MemoryRow>,
    limit: i64,
) -> Vec<MemoryRow> {
    let mut ranked = HashMap::<Uuid, (f64, MemoryRow)>::new();
    for (index, row) in keyword.into_iter().enumerate() {
        add_rank(&mut ranked, row, index);
    }
    for (index, row) in semantic.into_iter().enumerate() {
        add_rank(&mut ranked, row, index);
    }
    let mut values = ranked.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.1.created_at.cmp(&left.1.created_at))
    });
    values
        .into_iter()
        .take(limit as usize)
        .map(|(_, row)| row)
        .collect()
}

fn add_rank(ranked: &mut HashMap<Uuid, (f64, MemoryRow)>, row: MemoryRow, index: usize) {
    let score = 1.0 / (61.0 + index as f64);
    ranked
        .entry(row.id)
        .and_modify(|value| value.0 += score)
        .or_insert((score, row));
}
