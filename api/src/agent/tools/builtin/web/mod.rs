//! Web tools.
//!
//! `web_extract` fetches a page directly and returns readable text.
//! `web_search` resolves a backend at construction time and delegates to it:
//! SearXNG (`MYMY_SEARXNG_URL`) is the default in Docker Compose, and
//! DuckDuckGo is a zero-config fallback so the tool is always available
//! without any API key or external service.

mod search_backend;

use std::sync::Arc;

use async_trait::async_trait;
use regex::Regex;
use serde_json::Value;

use self::search_backend::{resolve_backend, SearchBackend};
use super::truncate_chars;
use crate::agent::tools::{
    tool_result, tool_schema, ToolCapability, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const MAX_EXTRACT_CHARS: usize = 20_000;

pub fn register(registry: &mut ToolRegistry) {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("mymy-native-agent/0.1")
        .build()
        .expect("reqwest client should build");

    registry.register(ToolEntry {
        name: "web_extract".to_string(),
        toolset: "web".to_string(),
        schema: tool_schema(
            "web_extract",
            "Fetch a web page and return readable text extracted from the HTML.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Absolute HTTP or HTTPS page URL to fetch." }
                },
                "required": ["url"]
            }),
        ),
        capability: ToolCapability::read("web").with_resource_argument("url"),
        handler: Arc::new(WebExtractTool { http: http.clone() }),
    });

    let (backend, backend_name) = resolve_backend(http);
    tracing::info!(backend = backend_name, "web_search backend resolved");

    registry.register(ToolEntry {
        name: "web_search".to_string(),
        toolset: "web".to_string(),
        schema: tool_schema(
            "web_search",
            "Search the web for current information.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Web search query." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 10, "description": "Maximum number of web results to return." }
                },
                "required": ["query"]
            }),
        ),
        capability: ToolCapability::external("web_search"),
        handler: Arc::new(WebSearchTool { backend }),
    });
}

struct WebExtractTool {
    http: reqwest::Client,
}

#[async_trait]
impl ToolHandler for WebExtractTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let url = args
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing url".to_string()))?;
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|err| ToolError::Execution(format!("fetch failed: {err}")))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|err| ToolError::Execution(format!("body read failed: {err}")))?;
        let text = html_to_text(&body);
        Ok(tool_result(&serde_json::json!({
            "url": url,
            "status": status,
            "text": truncate_chars(&text, MAX_EXTRACT_CHARS),
        })))
    }
}

struct WebSearchTool {
    backend: Box<dyn SearchBackend>,
}

#[async_trait]
impl ToolHandler for WebSearchTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let query = args
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing query".to_string()))?;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(5)
            .clamp(1, 10) as usize;

        let results = self.backend.search(query, limit).await?;
        Ok(tool_result(&serde_json::json!({
            "query": query,
            "results": results,
        })))
    }
}

fn html_to_text(html: &str) -> String {
    let scripts = Regex::new(r"(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>").unwrap();
    let tags = Regex::new(r"(?is)<[^>]+>").unwrap();
    let whitespace = Regex::new(r"[ \t\r\n]+").unwrap();
    let without_scripts = scripts.replace_all(html, " ");
    let without_tags = tags.replace_all(&without_scripts, " ");
    html_unescape(&whitespace.replace_all(&without_tags, " "))
        .trim()
        .to_string()
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_basic_html_text() {
        let text =
            html_to_text("<html><body><h1>Hello</h1><script>bad()</script>world</body></html>");
        assert_eq!(text, "Hello world");
    }
}
