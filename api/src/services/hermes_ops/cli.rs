//! Hermes CLI process execution.

use std::time::Duration;

use regex::Regex;
use tokio::process::Command;

use super::types::OpsError;

const OPS_TIMEOUT: Duration = Duration::from_secs(15);

/// Run a hermes CLI subcommand and return combined stdout+stderr output.
pub(super) async fn run_hermes_cli(
    cli_path: &str,
    args: &[&str],
    profile: Option<&str>,
) -> Result<String, OpsError> {
    let mut cmd = Command::new(cli_path);
    cmd.args(args);
    if let Some(p) = profile {
        cmd.args(["--profile", p]);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| OpsError::CliNotFound(format!("failed to spawn hermes CLI: {e}")))?;

    let output = match tokio::time::timeout(OPS_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(OpsError::Io(e.to_string())),
        Err(_) => return Err(OpsError::Timeout),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{stdout}\n{stderr}").trim().to_string())
}

/// Delete a Hermes chat session via `hermes sessions delete <id> --yes`.
pub async fn delete_session(
    cli_path: &str,
    session_id: &str,
    profile: Option<&str>,
) -> Result<(), OpsError> {
    let id_re = Regex::new(r"^\d{8}_\d{6}_[0-9a-f]{6}$").expect("valid regex");
    if !id_re.is_match(session_id) {
        return Err(OpsError::HermesFailed(format!(
            "invalid session id: {session_id}"
        )));
    }

    let mut cmd = Command::new(cli_path);
    cmd.args(["sessions", "delete", session_id, "--yes"]);
    if let Some(p) = profile {
        cmd.args(["--profile", p]);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| OpsError::CliNotFound(format!("failed to spawn hermes CLI: {e}")))?;

    let output = match tokio::time::timeout(OPS_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(OpsError::Io(e.to_string())),
        Err(_) => return Err(OpsError::Timeout),
    };

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(OpsError::HermesFailed(
            format!("{stdout}\n{stderr}").trim().to_string(),
        ));
    }

    Ok(())
}
