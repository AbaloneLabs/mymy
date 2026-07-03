//! Host command helpers used by sandbox backends.
//!
//! Bubblewrap and Firecracker both need a narrow escape hatch for privileged
//! host operations such as process termination, tap-device setup, and shell
//! pipelines. Centralizing those calls keeps failure messages consistent and
//! makes it clear which parts of the runner still depend on host binaries.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use super::error::RunnerError;
use super::path_policy::is_safe_env_key;

pub(crate) fn command_exists(command: &str) -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {}", sh_quote(command)))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub(crate) fn sh_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub(crate) fn remote_command(cwd: &Path, env: &BTreeMap<String, String>, command: &str) -> String {
    let assignments = env
        .iter()
        .filter(|(key, _)| is_safe_env_key(key))
        .map(|(key, value)| format!("{key}={}", sh_quote(value)))
        .collect::<Vec<_>>();
    let env_prefix = if assignments.is_empty() {
        String::new()
    } else {
        format!("env {} ", assignments.join(" "))
    };
    format!(
        "cd {} && {}bash -lc {}",
        sh_quote(&cwd.display().to_string()),
        env_prefix,
        sh_quote(command)
    )
}

pub(crate) async fn run_host_command(
    command: &mut Command,
    label: &str,
) -> Result<(), RunnerError> {
    let output = command
        .output()
        .await
        .map_err(|err| RunnerError::Execution(format!("{label} failed to start: {err}")))?;
    if output.status.success() {
        return Ok(());
    }
    Err(RunnerError::Execution(format!(
        "{label} failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )))
}

pub(crate) async fn run_host_shell(command: &str, label: &str) -> Result<(), RunnerError> {
    let mut shell = Command::new("bash");
    shell.arg("-lc").arg(command);
    run_host_command(&mut shell, label).await
}

pub(crate) async fn wait_for_socket(path: &Path) -> Result<(), RunnerError> {
    for _ in 0..100 {
        if path.exists() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(RunnerError::Unavailable(format!(
        "firecracker API socket was not created: {}",
        path.display()
    )))
}

pub(crate) async fn wait_for_pid_exit(pid: u32) -> bool {
    for _ in 0..20 {
        let running = Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false);
        if !running {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

pub(crate) async fn terminate_pid(pid: u32) {
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .await;
    if !wait_for_pid_exit(pid).await {
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await;
        let _ = wait_for_pid_exit(pid).await;
    }
}
