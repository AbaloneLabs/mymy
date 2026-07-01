//! Hermes chat service — runs `hermes chat -Q` as a subprocess.
//!
//! Multi-turn conversations use hermes's quiet query mode:
//!   - First message:  `hermes chat -Q -q "<text>" --source tool`
//!     → stdout: response text, stderr: `session_id: <id>`
//!   - Subsequent:     `hermes chat -Q --resume <id> -q "<text>" --source tool`
//!     → stdout: response text
//!
//! The `--source tool` flag keeps mymy sessions out of the user's hermes
//! session list. The `-Q` (quiet) flag suppresses banner/spinner/tool previews
//! so stdout contains only the final response.

use std::time::Duration;

use tokio::process::Command;

/// Outcome of sending a message to hermes.
pub struct ChatResult {
    /// The agent's response text (stdout).
    pub response: String,
    /// The hermes session ID. Present on the first message of a session
    /// (or when a resume yields a new compressed-session id).
    pub session_id: Option<String>,
}

/// Send a message to hermes, creating a new session.
///
/// Returns the response text and the newly-created session id.
pub async fn send_new(cli_path: &str, profile: &str, text: &str) -> Result<ChatResult, ChatError> {
    let mut cmd = Command::new(cli_path);
    cmd.args(["chat", "-Q", "-q", text, "--source", "tool"]);
    if !profile.is_empty() && profile != "default" {
        cmd.args(["-p", profile]);
    }
    run_hermes(cmd, true).await
}

/// Send a message to hermes, resuming an existing session.
///
/// The session id is passed via `--resume`. Returns the response text.
pub async fn send_resume(
    cli_path: &str,
    profile: &str,
    session_id: &str,
    text: &str,
) -> Result<ChatResult, ChatError> {
    let mut cmd = Command::new(cli_path);
    cmd.args([
        "chat", "-Q", "--resume", session_id, "-q", text, "--source", "tool",
    ]);
    if !profile.is_empty() && profile != "default" {
        cmd.args(["-p", profile]);
    }
    // resume doesn't emit a new session_id normally, but we still parse stderr
    run_hermes(cmd, false).await
}

/// Run the hermes command, capturing stdout (response) and stderr (session id).
///
/// `expect_session_id` controls whether a missing session id on stderr is an
/// error (first message must yield one) or acceptable (resume).
async fn run_hermes(mut cmd: Command, expect_session_id: bool) -> Result<ChatResult, ChatError> {
    // Prevent the child from inheriting our stdin (it must not enter REPL mode).
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| ChatError::CliNotFound(format!("failed to spawn hermes CLI: {e}")))?;

    // Apply a generous timeout for LLM responses. Hermes retries transient
    // provider errors (e.g. Z.AI overload 429s) with progressively longer
    // backoff (30s → 60s → 90s → 120s), so the full retry sequence can take
    // several minutes before either succeeding or giving up.
    let timeout = Duration::from_secs(600);
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(ChatError::Io(e.to_string())),
        Err(_) => return Err(ChatError::Timeout),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Hermes prints its error messages (e.g. "API call failed: HTTP 429")
        // to stdout, not stderr. Include both so the real cause surfaces.
        let detail = if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(ChatError::HermesFailed(format!(
            "hermes exited with status {}: {}",
            output.status, detail
        )));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let response = clean_response(raw.as_ref());
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse `session_id: <id>` from stderr.
    let session_id = parse_session_id(&stderr);

    if expect_session_id && session_id.is_none() {
        tracing::warn!(stderr = %stderr, "expected session_id on stderr but none found");
    }

    Ok(ChatResult {
        response,
        session_id,
    })
}

/// Clean the hermes stdout response:
/// 1. Strip ANSI escape sequences (colors, cursor moves).
/// 2. Remove diagnostic lines (Node.js/browser-tools checks, "Detected:" etc.)
///    that hermes prints before the actual response in `-Q` mode.
/// 3. Trim surrounding whitespace.
fn clean_response(raw: &str) -> String {
    // Regex to strip ANSI escape sequences.
    // Matches CSI sequences: \x1b[ ... letter, plus OSC sequences.
    let ansi_re = regex::Regex::new(r"\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07").unwrap();
    let no_ansi = ansi_re.replace_all(raw, "");

    // Filter out diagnostic lines that hermes prints before the real response.
    // These are environment-check messages (Node.js detection, OS detection, etc.)
    let mut clean_lines: Vec<&str> = Vec::new();
    for line in no_ansi.lines() {
        let trimmed = line.trim();
        // Skip empty lines and known diagnostic patterns.
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("Detected:") {
            continue;
        }
        if trimmed.starts_with("→") {
            continue;
        }
        if trimmed.starts_with("✓") {
            continue;
        }
        if trimmed.starts_with("⚠") {
            continue;
        }
        if trimmed.starts_with("Install manually:") {
            continue;
        }
        clean_lines.push(line);
    }

    clean_lines.join("\n").trim().to_string()
}

/// Extract the session id from hermes stderr output.
/// Format: `session_id: 20260617_133511_c61b3b`
fn parse_session_id(stderr: &str) -> Option<String> {
    for line in stderr.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("session_id:") {
            let id = rest.trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

/// Errors that can occur during a hermes chat call.
#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("hermes CLI not found: {0}")]
    CliNotFound(String),
    #[error("hermes command timed out (no response within 600s)")]
    Timeout,
    #[error("hermes failed: {0}")]
    HermesFailed(String),
    #[error("io error: {0}")]
    Io(String),
}
