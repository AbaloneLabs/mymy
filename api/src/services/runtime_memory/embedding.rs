//! Deterministic local semantic features for runtime memory.
//!
//! The embedding is deliberately local and dependency-free: memory content
//! never leaves mymy, output dimensions stay stable for pgvector, and a small
//! canonical vocabulary improves recall without claiming general-purpose
//! language-model semantics.

use sha2::{Digest, Sha256};

pub(super) fn local_feature_embedding(value: &str) -> Vec<f32> {
    const DIMENSIONS: usize = 384;
    let mut vector = vec![0.0_f32; DIMENSIONS];
    let mut tokens = value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(canonical_token)
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        tokens.push(value.to_lowercase());
    }
    let mut features = tokens.clone();
    features.extend(
        tokens
            .windows(2)
            .map(|pair| format!("{}:{}", pair[0], pair[1])),
    );
    for token in &tokens {
        let characters = token.chars().collect::<Vec<_>>();
        features.extend(
            characters
                .windows(3)
                .map(|trigram| trigram.iter().collect::<String>()),
        );
    }
    for feature in features {
        let digest = Sha256::digest(feature.as_bytes());
        let index = usize::from(u16::from_be_bytes([digest[0], digest[1]])) % DIMENSIONS;
        let sign = if digest[2] & 1 == 0 { 1.0 } else { -1.0 };
        vector[index] += sign;
    }
    let norm = vector
        .iter()
        .map(|component| component * component)
        .sum::<f32>()
        .sqrt();
    if norm > 0.0 {
        for component in &mut vector {
            *component /= norm;
        }
    }
    vector
}

fn canonical_token(value: &str) -> String {
    let lower = value.to_lowercase();
    match lower.as_str() {
        "complete" | "completed" | "completes" | "finish" | "finished" | "finishes" => {
            "complete".to_string()
        }
        "task" | "tasks" | "work" | "works" | "job" | "jobs" | "item" | "items" => {
            "task".to_string()
        }
        "success" | "successes" | "successful" | "done" => "success".to_string(),
        "database" | "postgres" | "postgresql" => "database".to_string(),
        "remember" | "memory" | "recall" => "memory".to_string(),
        _ => lower,
    }
}

pub(super) fn vector_literal(vector: &[f32]) -> String {
    format!(
        "[{}]",
        vector
            .iter()
            .map(|component| component.to_string())
            .collect::<Vec<_>>()
            .join(",")
    )
}
