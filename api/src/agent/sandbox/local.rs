//! Local process execution backend.
//!
//! This backend is useful for trusted single-user development. It keeps code
//! execution deterministic and bounded, but it is not a privilege boundary:
//! callers that need hostile-code isolation must switch to a container backend
//! through the same `ExecutionEnvironment` trait.

use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use tokio::process::Command;

use super::env::{ExecOptions, ExecResult, ExecutionEnvironment};
use super::scrub::scrubbed_env;
use super::SandboxError;

#[derive(Debug, Clone)]
pub struct LocalEnvironment {
    working_dir: PathBuf,
    scratch_dir: PathBuf,
}

impl LocalEnvironment {
    pub fn new(working_dir: PathBuf, scratch_dir: PathBuf) -> Self {
        Self {
            working_dir,
            scratch_dir,
        }
    }

    fn resolve_cwd(&self, requested: Option<PathBuf>) -> Result<PathBuf, SandboxError> {
        let root = canonicalize_existing(&self.working_dir)?;
        let cwd = match requested {
            Some(path) => {
                let path = if path.is_absolute() {
                    path
                } else {
                    self.working_dir.join(path)
                };
                canonicalize_existing(&path)?
            }
            None => self
                .read_persisted_cwd()
                .and_then(|path| canonicalize_existing(&path).ok())
                .unwrap_or_else(|| root.clone()),
        };
        if !cwd.starts_with(&root) {
            return Err(SandboxError::InvalidRequest(
                "cwd must stay inside the workspace".to_string(),
            ));
        }
        Ok(cwd)
    }

    fn cwd_file(&self) -> PathBuf {
        self.scratch_dir.join(".cwd")
    }

    fn read_persisted_cwd(&self) -> Option<PathBuf> {
        let content = std::fs::read_to_string(self.cwd_file()).ok()?;
        let trimmed = content.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }
}

#[async_trait]
impl ExecutionEnvironment for LocalEnvironment {
    async fn execute(&self, options: ExecOptions) -> Result<ExecResult, SandboxError> {
        if options.language != "python" {
            return Err(SandboxError::InvalidRequest(
                "only python is supported".to_string(),
            ));
        }
        tokio::fs::create_dir_all(&self.scratch_dir)
            .await
            .map_err(|err| SandboxError::Execution(format!("scratch dir create failed: {err}")))?;
        let cwd = self.resolve_cwd(options.cwd)?;
        let script = self
            .scratch_dir
            .join(format!("exec-{}.py", uuid::Uuid::new_v4()));
        let runner = self
            .scratch_dir
            .join(format!("runner-{}.py", uuid::Uuid::new_v4()));
        let cwd_file = self.cwd_file();
        tokio::fs::write(&script, options.code)
            .await
            .map_err(|err| SandboxError::Execution(format!("script write failed: {err}")))?;
        let runner_code = format!(
            r#"import os
import runpy
import sys

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

        let output = tokio::time::timeout(
            Duration::from_secs(options.timeout_secs),
            Command::new("python3")
                .arg(&runner)
                .current_dir(&cwd)
                .env_clear()
                .envs(scrubbed_env())
                .envs(options.extra_env)
                .output(),
        )
        .await
        .map_err(|_| SandboxError::Timeout(options.timeout_secs))?
        .map_err(|err| SandboxError::Unavailable(format!("python3 execution failed: {err}")))?;

        let _ = tokio::fs::remove_file(&script).await;
        let _ = tokio::fs::remove_file(&runner).await;
        let cwd = self
            .read_persisted_cwd()
            .unwrap_or(cwd)
            .display()
            .to_string();
        Ok(ExecResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            cwd,
        })
    }
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, SandboxError> {
    path.canonicalize()
        .map_err(|err| SandboxError::InvalidRequest(format!("invalid path: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_cwd_outside_workspace() {
        let env = LocalEnvironment::new(PathBuf::from("/tmp"), PathBuf::from("/tmp/mymy-sandbox"));
        let err = env.resolve_cwd(Some(PathBuf::from("/"))).unwrap_err();
        assert!(err.to_string().contains("cwd must stay inside"));
    }
}
