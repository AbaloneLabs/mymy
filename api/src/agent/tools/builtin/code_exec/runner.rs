use std::path::{Path, PathBuf};

use super::super::workspace_paths::WorkspacePathPolicy;
use crate::agent::sandbox::{ExecOptions, ExecResult, SandboxError};
use crate::services::sandbox_runner::{roots_for_runner, RunnerClient, RunnerExecuteRequest};

pub(super) async fn execute_python_with_runner(
    runner_url: &str,
    working_dir: &Path,
    allowed_roots: &[PathBuf],
    scratch_dir: &Path,
    options: ExecOptions,
    execution_id: Option<&str>,
) -> Result<ExecResult, SandboxError> {
    if options.language != "python" {
        return Err(SandboxError::InvalidRequest(
            "only python is supported".to_string(),
        ));
    }
    tokio::fs::create_dir_all(&scratch_dir)
        .await
        .map_err(|err| SandboxError::Execution(format!("scratch dir create failed: {err}")))?;
    let cwd = resolve_runner_cwd(working_dir, allowed_roots, options.cwd)?;
    let script = scratch_dir.join(format!("exec-{}.py", uuid::Uuid::new_v4()));
    let runner = scratch_dir.join(format!("runner-{}.py", uuid::Uuid::new_v4()));
    let cwd_file = scratch_dir.join(".cwd");
    tokio::fs::write(&script, options.code)
        .await
        .map_err(|err| SandboxError::Execution(format!("script write failed: {err}")))?;
    let runner_code = format!(
        r#"import os
import runpy

script = {script:?}
cwd_file = {cwd_file:?}
try:
    runpy.run_path(script, run_name="__main__")
finally:
    with open(cwd_file, "w", encoding="utf-8") as handle:
        handle.write(os.getcwd())
"#,
        script = script.display().to_string(),
        cwd_file = cwd_file.display().to_string()
    );
    tokio::fs::write(&runner, runner_code)
        .await
        .map_err(|err| SandboxError::Execution(format!("runner write failed: {err}")))?;

    let mut extra_roots = Vec::with_capacity(allowed_roots.len() + 1);
    extra_roots.push(scratch_dir.to_path_buf());
    extra_roots.extend(allowed_roots.iter().cloned());

    let client = RunnerClient::new(runner_url.to_string());
    let request = RunnerExecuteRequest {
        execution_id: execution_id.map(str::to_string),
        command: format!("python3 {}", shell_quote(&runner.display().to_string())),
        cwd: cwd.display().to_string(),
        roots: roots_for_runner(working_dir, &extra_roots),
        timeout_secs: Some(options.timeout_secs),
        env: Some(options.extra_env),
    };
    let response = if let (Some(cancellation), Some(execution_id)) =
        (options.cancellation, execution_id)
    {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                let _ = client.cancel_execution(execution_id).await;
                Err(SandboxError::Execution("execution cancelled".to_string()))
            }
            result = client.execute(&request) => result.map_err(|err| SandboxError::Execution(err.to_string())),
        }
    } else {
        client
            .execute(&request)
            .await
            .map_err(|err| SandboxError::Execution(err.to_string()))
    };
    let _ = tokio::fs::remove_file(&script).await;
    let _ = tokio::fs::remove_file(&runner).await;
    let response = response?;
    let cwd = tokio::fs::read_to_string(&cwd_file)
        .await
        .ok()
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .unwrap_or(response.cwd);
    Ok(ExecResult {
        success: response.success,
        stdout: response.stdout,
        stderr: response.stderr,
        exit_code: response.exit_code,
        cwd,
    })
}

pub(super) fn resolve_runner_cwd(
    working_dir: &Path,
    allowed_roots: &[PathBuf],
    requested: Option<PathBuf>,
) -> Result<PathBuf, SandboxError> {
    let paths = WorkspacePathPolicy::new(working_dir.to_path_buf(), allowed_roots.to_vec());
    match requested {
        Some(path) => paths
            .resolve_directory_path(&path)
            .map_err(|err| SandboxError::InvalidRequest(err.to_string())),
        None => Ok(paths.root().to_path_buf()),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
