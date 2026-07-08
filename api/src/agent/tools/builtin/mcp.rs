//! Minimal MCP client tools.
//!
//! Servers are loaded from `data/agent/mcp/servers.json`. Stdio subprocesses
//! receive only a safe baseline environment plus explicitly configured keys,
//! so local credentials are not leaked to arbitrary MCP servers.

mod client;
mod config;
mod content;
mod inspection;
mod naming;
mod tools;
mod types;

pub use inspection::inspect_servers;
pub use tools::{register, register_dynamic_tools};
pub use types::McpServerStatus;

const DEFAULT_TIMEOUT_SECS: u64 = 60;

#[cfg(test)]
mod tests;
