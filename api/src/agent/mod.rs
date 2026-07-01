//! Native agent runtime — absorbs Hermes's agent capabilities into Rust.
//!
//! This module replaces the external Hermes Python dependency with a
//! self-contained Rust implementation. Phase 1 establishes the LLM
//! provider abstraction layer.

pub mod crypto;
pub mod providers;
