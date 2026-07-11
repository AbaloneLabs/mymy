use std::path::PathBuf;

use serde_json::Value;

use super::runner::resolve_runner_cwd;
use super::*;
use crate::agent::tools::ToolHandler;

fn temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("mymy-code-exec-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

fn test_tool(workspace: PathBuf, scratch: PathBuf) -> CodeExecTool {
    CodeExecTool {
        working_dir: workspace,
        allowed_roots: Vec::new(),
        scratch_dir: scratch,
        runner_url: None,
        allowed_tools: ["read_file", "search_files", "write_file", "patch_file"]
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        db: None,
        agent_profile: None,
        app_state: None,
    }
}

#[tokio::test]
async fn python_can_call_allowed_tools_via_rpc() {
    let workspace = temp_dir("workspace");
    let scratch = temp_dir("scratch");
    std::fs::write(workspace.join("sample.txt"), "needle\nsecond").unwrap();
    let tool = test_tool(workspace.clone(), scratch.clone());

    let output = tool
        .execute(&serde_json::json!({
            "code": r#"import json
import mymy_tools
print(mymy_tools.read_file("sample.txt")["content"])
print(len(mymy_tools.search_files("needle")["matches"]))
"#
        }))
        .await
        .unwrap();
    let parsed = serde_json::from_str::<Value>(&output).unwrap();
    assert!(parsed["stdout"].as_str().unwrap().contains("needle"));
    assert!(parsed["stdout"].as_str().unwrap().contains("1"));

    let _ = std::fs::remove_dir_all(workspace);
    let _ = std::fs::remove_dir_all(scratch);
}

#[tokio::test]
async fn cwd_persists_across_calls_in_same_scratch_session() {
    let workspace = temp_dir("workspace");
    let scratch = temp_dir("scratch");
    std::fs::create_dir_all(workspace.join("nested")).unwrap();
    let tool = test_tool(workspace.clone(), scratch.clone());

    tool.execute(&serde_json::json!({
        "code": r#"import os
os.chdir("nested")
"#
    }))
    .await
    .unwrap();
    let output = tool
        .execute(&serde_json::json!({
            "code": r#"import os
print(os.path.basename(os.getcwd()))
"#
        }))
        .await
        .unwrap();
    let parsed = serde_json::from_str::<Value>(&output).unwrap();
    assert!(parsed["stdout"].as_str().unwrap().contains("nested"));

    let _ = std::fs::remove_dir_all(workspace);
    let _ = std::fs::remove_dir_all(scratch);
}

#[tokio::test]
async fn python_can_write_and_patch_files_via_rpc() {
    let workspace = temp_dir("workspace");
    let scratch = temp_dir("scratch");
    let tool = test_tool(workspace.clone(), scratch.clone());

    let output = tool
        .execute(&serde_json::json!({
            "code": r#"import mymy_tools
mymy_tools.write_file("generated.txt", "alpha\n")
mymy_tools.patch_file("generated.txt", "alpha", "beta")
print(mymy_tools.read_file("generated.txt")["content"])
"#
        }))
        .await
        .unwrap();
    let parsed = serde_json::from_str::<Value>(&output).unwrap();
    assert!(parsed["stdout"].as_str().unwrap().contains("beta"));

    let _ = std::fs::remove_dir_all(workspace);
    let _ = std::fs::remove_dir_all(scratch);
}

#[tokio::test]
async fn python_rpc_can_write_shared_logical_drive_path() {
    let base = temp_dir("drive");
    let workspace = base.join("drive").join("agents").join("elena");
    let shared = base.join("drive").join("shared");
    let scratch = temp_dir("scratch");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&shared).unwrap();
    let tool = CodeExecTool {
        working_dir: workspace.clone(),
        allowed_roots: vec![shared.clone()],
        scratch_dir: scratch.clone(),
        runner_url: None,
        allowed_tools: ["read_file", "search_files", "write_file", "patch_file"]
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        db: None,
        agent_profile: None,
        app_state: None,
    };

    let output = tool
        .execute(&serde_json::json!({
            "code": r#"import mymy_tools
mymy_tools.write_file("/drive/shared/generated.txt", "shared\n")
print(mymy_tools.read_file("/drive/shared/generated.txt")["content"])
"#
        }))
        .await
        .unwrap();
    let parsed = serde_json::from_str::<Value>(&output).unwrap();
    assert!(parsed["stdout"].as_str().unwrap().contains("shared"));
    assert_eq!(
        std::fs::read_to_string(shared.join("generated.txt")).unwrap(),
        "shared\n"
    );

    let _ = std::fs::remove_dir_all(base);
    let _ = std::fs::remove_dir_all(scratch);
}

#[test]
fn runner_cwd_accepts_logical_shared_drive_path() {
    let base = temp_dir("drive");
    let workspace = base.join("drive").join("agents").join("elena");
    let shared = base.join("drive").join("shared");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&shared).unwrap();

    let cwd = resolve_runner_cwd(
        &workspace,
        std::slice::from_ref(&shared),
        Some("/drive/shared".into()),
    )
    .unwrap();
    assert_eq!(cwd, shared.canonicalize().unwrap());

    let _ = std::fs::remove_dir_all(base);
}
