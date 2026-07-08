use std::path::Path;

use serde_json::Value;

use super::command::TerminalTool;
use super::validation::{allowed_roots, check_redirected_paths, ensure_directory};
use crate::agent::tools::ToolHandler;

fn test_tool() -> TerminalTool {
    TerminalTool {
        working_dir: std::env::current_dir().unwrap(),
        allowed_roots: allowed_roots(&std::env::current_dir().unwrap(), &[]),
        runner_url: None,
        db: None,
        agent_profile: None,
        project_id: None,
        preview_host: "127.0.0.1".to_string(),
    }
}

#[tokio::test]
async fn terminal_runs_harmless_command() {
    let output = test_tool()
        .execute(&serde_json::json!({"command":"printf hello"}))
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&output).unwrap()["stdout"],
        "hello"
    );
}

#[tokio::test]
async fn terminal_blocks_hardline_command() {
    let err = test_tool()
        .execute(&serde_json::json!({"command":"shutdown now"}))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("blocked"));
}

#[tokio::test]
async fn terminal_runs_non_hardline_command_with_process_access() {
    let output = test_tool()
        .execute(&serde_json::json!({"command":"printf 'DELETE FROM users'"}))
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&output).unwrap()["stdout"],
        "DELETE FROM users"
    );
}

#[tokio::test]
async fn terminal_redacts_secret_shaped_output() {
    let output = test_tool()
        .execute(&serde_json::json!({"command":"printf 'API_KEY=sk-abcdefghijklmnop'"}))
        .await
        .unwrap();
    let parsed = serde_json::from_str::<Value>(&output).unwrap();
    assert!(parsed["stdout"].as_str().unwrap().contains("[REDACTED]"));
}

#[tokio::test]
async fn terminal_blocks_sensitive_output_redirection() {
    let err = test_tool()
        .execute(&serde_json::json!({"command":"printf secret > .env"}))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("sensitive path"));
}

#[test]
fn ensure_directory_accepts_logical_shared_drive_path() {
    let base = std::env::temp_dir().join(format!("mymy-terminal-{}", uuid::Uuid::new_v4()));
    let agent = base.join("drive").join("agents").join("elena");
    let shared = base.join("drive").join("shared");
    std::fs::create_dir_all(&agent).unwrap();
    std::fs::create_dir_all(&shared).unwrap();
    let roots = allowed_roots(&agent, std::slice::from_ref(&shared));

    let resolved = ensure_directory(&agent, &roots, Path::new("/drive/shared")).unwrap();
    assert_eq!(resolved, shared.canonicalize().unwrap());

    let _ = std::fs::remove_dir_all(base);
}

#[tokio::test]
async fn redirection_allows_logical_shared_drive_path() {
    let base = std::env::temp_dir().join(format!("mymy-terminal-{}", uuid::Uuid::new_v4()));
    let agent = base.join("drive").join("agents").join("elena");
    let shared = base.join("drive").join("shared");
    std::fs::create_dir_all(&agent).unwrap();
    std::fs::create_dir_all(&shared).unwrap();
    let roots = allowed_roots(&agent, std::slice::from_ref(&shared));

    check_redirected_paths(None, "printf ok > /drive/shared/check.txt", &agent, &roots)
        .await
        .unwrap();

    let _ = std::fs::remove_dir_all(base);
}
