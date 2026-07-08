use std::collections::BTreeMap;

use crate::agent::security::SecretString;

use super::client::parse_rpc_response_for_id;
use super::config::filtered_env;
use super::content::process_content_blocks;
use super::naming::prefixed_tool_name;

#[test]
fn filtered_env_uses_explicit_secret_only() {
    let mut configured = BTreeMap::new();
    configured.insert("API_KEY".to_string(), SecretString::new("secret"));
    let env = filtered_env(&configured);
    assert_eq!(env.get("API_KEY").unwrap(), "secret");
}

#[test]
fn prefixed_tool_name_is_provider_safe() {
    assert_eq!(
        prefixed_tool_name("file-system", "read/file"),
        "file_system_read_file"
    );
    assert_eq!(prefixed_tool_name("1", "2"), "mcp_1_2");
}

#[test]
fn rpc_response_requires_expected_id() {
    let ok =
        parse_rpc_response_for_id(r#"{"jsonrpc":"2.0","id":2,"result":{"ok":true}}"#, 2).unwrap();
    assert_eq!(ok["ok"], true);
    let err = parse_rpc_response_for_id(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#, 2).unwrap_err();
    assert!(err.to_string().contains("id mismatch"));
}

#[tokio::test]
async fn content_blocks_extract_text_and_cache_media() {
    let dir = std::env::temp_dir().join(format!("mymy-mcp-media-{}", uuid::Uuid::new_v4()));
    let result = process_content_blocks(
        serde_json::json!({
            "content": [
                { "type": "text", "text": "hello" },
                { "type": "image", "mimeType": "image/png", "data": "aGk=" }
            ]
        }),
        &dir,
    )
    .await
    .unwrap();
    assert_eq!(result["content"], "hello");
    let path = result["media"][0]["path"].as_str().unwrap();
    assert!(std::path::Path::new(path).exists());
    let _ = std::fs::remove_dir_all(dir);
}
