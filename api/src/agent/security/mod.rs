//! Security primitives for the native agent runtime.
//!
//! The agent can inspect local files and, in later phases, execute local
//! commands. These helpers are deliberately independent from HTTP handlers and
//! tool implementations so every execution path can share the same redaction,
//! path guard, dangerous-command detection, and prompt-injection scanning.

pub mod dangerous;
pub mod filesystem;
pub mod redact;
pub mod threat;
pub mod tls;

pub use dangerous::{detect_dangerous_command, Severity};
pub use filesystem::{ensure_read_allowed, ensure_write_allowed, is_sensitive_path};
pub use redact::{redact_sensitive_text, redact_terminal_output, SecretString};
pub use threat::{scan_for_threats, ThreatScope};
pub use tls::verify_ca_bundle;
