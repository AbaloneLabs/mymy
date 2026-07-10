//! Web tools.
//!
//! `web_extract` works with direct HTTP fetches. `web_search` uses Tavily
//! when `TAVILY_API_KEY` is configured; without that key the registry marks
//! the search tool unavailable instead of returning fake results.

use std::sync::Arc;

use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;

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
                    "url": { "type": "string" }
                },
                "required": ["url"]
            }),
        ),
        capability: ToolCapability::read("web").with_resource_argument("url"),
        handler: Arc::new(WebExtractTool { http: http.clone() }),
    });

    registry.register(ToolEntry {
        name: "web_search".to_string(),
        toolset: "web".to_string(),
        schema: tool_schema(
            "web_search",
            "Search the web using Tavily. Requires TAVILY_API_KEY.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
                },
                "required": ["query"]
            }),
        ),
        capability: ToolCapability::external("web_search"),
        handler: Arc::new(WebSearchTool { http }),
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
    http: reqwest::Client,
}

#[async_trait]
impl ToolHandler for WebSearchTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let api_key = std::env::var("TAVILY_API_KEY")
            .map_err(|_| ToolError::Unavailable("TAVILY_API_KEY is not configured".to_string()))?;
        let query = args
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing query".to_string()))?;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(5)
            .clamp(1, 10);

        let response = self
            .http
            .post("https://api.tavily.com/search")
            .json(&serde_json::json!({
                "api_key": api_key,
                "query": query,
                "max_results": limit,
            }))
            .send()
            .await
            .map_err(|err| ToolError::Execution(format!("search failed: {err}")))?;

        if !response.status().is_success() {
            return Err(ToolError::Execution(format!(
                "search returned HTTP {}",
                response.status().as_u16()
            )));
        }

        let parsed = response
            .json::<TavilyResponse>()
            .await
            .map_err(|err| ToolError::Execution(format!("search parse failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "query": query,
            "results": parsed.results,
        })))
    }

    fn is_available(&self) -> bool {
        std::env::var("TAVILY_API_KEY").is_ok()
    }
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct TavilyResponse {
    #[serde(default)]
    results: Vec<TavilyResult>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct TavilyResult {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
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
