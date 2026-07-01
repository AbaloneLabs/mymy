//! Native agent runtime — absorbs Hermes's agent capabilities into Rust.
//!
//! This module replaces the external Hermes Python dependency with a
//! self-contained Rust implementation. Provider transports, the agent loop,
//! tools, prompt assembly, and context management remain separate so the
//! runtime can evolve without leaking provider-specific details into
//! orchestration.

pub mod clarify;
pub mod context;
pub mod crypto;
pub mod loop_engine;
pub mod memory;
pub mod prompt;
pub mod providers;
pub mod runtime;
pub mod sandbox;
pub mod scheduler;
pub mod security;
pub mod skills;
pub mod tools;
