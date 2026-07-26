//! Pluggable web search backends.
//!
//! `web_search` resolves a single backend at construction time and delegates
//! every query to it. The resolution priority is:
//!
//! 1. `SearXNG` — when `MYMY_SEARXNG_URL` points at a self-hosted instance.
//!    This is the Docker Compose default and the recommended backend: it is a
//!    meta-search engine with a stable JSON API and no external API key.
//! 2. `DuckDuckGo` — zero-config fallback used by standalone `cargo run` and
//!    any environment without SearXNG. It scrapes the public HTML endpoint,
//!    so it needs no credentials but is more fragile to markup changes.
//!
//! Because DuckDuckGo is always reachable, `web_search` is always available;
//! there is no "unconfigured" state that hides the tool from the model.

use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::agent::tools::ToolError;

/// Environment variable that selects the SearXNG backend when set.
pub(crate) const SEARXNG_URL_ENV: &str = "MYMY_SEARXNG_URL";

/// One search hit, serialized to the shape the frontend expects:
/// `{ title, url, content }`. Both backends normalize their raw responses into
/// this struct so the tool handler and UI never need to know which engine ran.
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub content: String,
}

/// A single search engine behind `web_search`.
///
/// Implementations are constructed once (at tool registration) and reused for
/// every query. They own their HTTP client so connection pooling is shared
/// across calls.
#[async_trait]
pub trait SearchBackend: Send + Sync {
    /// Run `query` and return at most `limit` results.
    async fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, ToolError>;
}

/// Choose the active backend from the process environment.
///
/// Returns the backend instance plus its name so callers can log which engine
/// is serving `web_search`. The decision is made once at registration time to
/// avoid re-reading the environment on every query.
pub(crate) fn resolve_backend(http: reqwest::Client) -> (Box<dyn SearchBackend>, &'static str) {
    match std::env::var(SEARXNG_URL_ENV)
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(base_url) => {
            let backend = SearxngBackend::new(http, base_url);
            (Box::new(backend), SearxngBackend::BACKEND_NAME)
        }
        None => (
            Box::new(DuckDuckGoBackend::new(http)),
            DuckDuckGoBackend::BACKEND_NAME,
        ),
    }
}

// ---------------------------------------------------------------------------
// SearXNG
// ---------------------------------------------------------------------------

/// SearXNG self-hosted meta-search backend.
///
/// Calls `GET {base_url}/search?q=...&format=json`. SearXNG must be configured
/// with `json` in `search.formats`; the bundled `scripts/searxng-settings.yml`
/// enables this for the Docker Compose deployment.
struct SearxngBackend {
    http: reqwest::Client,
    base_url: String,
}

impl SearxngBackend {
    const BACKEND_NAME: &'static str = "searxng";

    fn new(http: reqwest::Client, base_url: String) -> Self {
        // Trim any trailing slash so `{base_url}/search` is well-formed
        // regardless of how the operator wrote the URL.
        let base_url = base_url.trim_end_matches('/').to_string();
        Self { http, base_url }
    }
}

#[async_trait]
impl SearchBackend for SearxngBackend {
    async fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, ToolError> {
        let endpoint = format!("{}/search", self.base_url);
        let response = self
            .http
            .get(&endpoint)
            .query(&[("q", query), ("format", "json")])
            .send()
            .await
            .map_err(|err| ToolError::Execution(format!("searxng request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(ToolError::Execution(format!(
                "searxng returned HTTP {}",
                response.status().as_u16()
            )));
        }

        let parsed = response
            .json::<SearxngResponse>()
            .await
            .map_err(|err| ToolError::Execution(format!("searxng parse failed: {err}")))?;

        Ok(parsed
            .results
            .into_iter()
            .take(limit)
            .map(|item| SearchResult {
                title: item.title,
                url: item.url,
                content: item.content,
            })
            .collect())
    }
}

/// SearXNG `/search?format=json` envelope.
#[derive(Debug, Deserialize)]
struct SearxngResponse {
    #[serde(default)]
    results: Vec<SearxngItem>,
}

/// Single SearXNG result item. All fields are defaulted so a missing key in
/// the response never fails the whole parse.
#[derive(Debug, Deserialize)]
struct SearxngItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
}

// ---------------------------------------------------------------------------
// DuckDuckGo
// ---------------------------------------------------------------------------

/// DuckDuckGo HTML-scraping backend.
///
/// Uses the key-free `https://html.duckduckgo.com/html/` endpoint, which
/// returns a server-rendered results page. This is intentionally defensive:
/// malformed entries are skipped rather than failing the entire query, so a
/// markup tweak upstream degrades gracefully (fewer results) instead of
/// breaking `web_search` outright.
struct DuckDuckGoBackend {
    http: reqwest::Client,
}

impl DuckDuckGoBackend {
    const BACKEND_NAME: &'static str = "duckduckgo";
    const ENDPOINT: &'static str = "https://html.duckduckgo.com/html/";

    fn new(http: reqwest::Client) -> Self {
        Self { http }
    }
}

#[async_trait]
impl SearchBackend for DuckDuckGoBackend {
    async fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, ToolError> {
        let response = self
            .http
            .post(Self::ENDPOINT)
            .form(&[("q", query)])
            .send()
            .await
            .map_err(|err| ToolError::Execution(format!("duckduckgo request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(ToolError::Execution(format!(
                "duckduckgo returned HTTP {}",
                response.status().as_u16()
            )));
        }

        let html = response
            .text()
            .await
            .map_err(|err| ToolError::Execution(format!("duckduckgo body read failed: {err}")))?;

        Ok(parse_duckduckgo_html(&html, limit))
    }
}

/// Extract search results from a DuckDuckGo HTML results page.
///
/// DuckDuckGo wraps each result in a block containing an anchor with class
/// `result__a` (title + redirect link) and a snippet with class
/// `result__snippet`. Real destination URLs are encoded inside the redirect
/// path as `//duckduckgo.com/l/?uddg=<percent-encoded url>`.
fn parse_duckduckgo_html(html: &str, limit: usize) -> Vec<SearchResult> {
    let link_re = Regex::new(
        // Capture group 1 = raw href, group 2 = visible link text.
        r#"(?is)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#,
    )
    .expect("duckduckgo link regex should compile");

    // Snippets are not nested inside the anchor, so they are matched
    // independently and associated with a result by document order.
    let snippet_re = Regex::new(r#"(?is)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>"#)
        .expect("duckduckgo snippet regex should compile");

    let snippets: Vec<String> = snippet_re
        .captures_iter(html)
        .map(|cap| strip_tags(&cap[1]))
        .collect();

    link_re
        .captures_iter(html)
        .enumerate()
        .filter_map(|(index, cap)| {
            let raw_href = html_unescape(&cap[1]);
            let title = strip_tags(&cap[2]);
            // Skip entries we cannot resolve to a usable URL — a missing
            // destination is not a useful search result.
            let url = decode_duckduckgo_redirect(&raw_href).unwrap_or(raw_href);
            if url.is_empty() && title.is_empty() {
                return None;
            }
            let content = snippets.get(index).cloned().unwrap_or_default();
            Some(SearchResult {
                title,
                url,
                content,
            })
        })
        .take(limit)
        .collect()
}

/// Resolve the real destination URL from a DuckDuckGo redirect link.
///
/// Redirect links look like `//duckduckgo.com/l/?uddg=<encoded>` (protocol
/// relative) or `/l/?uddg=<encoded>`. Returns the decoded URL when the
/// `uddg` parameter is present, otherwise `None` so the caller can fall back
/// to the raw href.
fn decode_duckduckgo_redirect(href: &str) -> Option<String> {
    // Only attempt decoding on links that actually carry the redirect marker.
    let query_start = href.find("uddg=")?;
    let after = &href[query_start + "uddg=".len()..];
    // The encoded value runs until the next `&`, `#`, or end of string.
    let end = after.find(['&', '#']).unwrap_or(after.len());
    let encoded = &after[..end];
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8_lossy()
        .into_owned();
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}

/// Remove all HTML tags from a fragment and collapse whitespace.
fn strip_tags(html: &str) -> String {
    let tag_re = Regex::new(r"(?is)<[^>]+>").expect("strip_tags regex should compile");
    let ws_re = Regex::new(r"\s+").expect("whitespace regex should compile");
    let stripped = tag_re.replace_all(html, " ");
    ws_re.replace_all(&stripped, " ").trim().to_string()
}

/// Unescape the common HTML entities DuckDuckGo emits in result markup.
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

    const SAMPLE_DDG_HTML: &str = r#"
<html><body>
<div class="results">
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frust&rut=abc">
      Rust Programming Language
    </a>
    <a class="result__snippet">A systems language empowering everyone to build reliable software.</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Flearn">
      Learn Rust
    </a>
    <a class="result__snippet">Official documentation and tutorials.</a>
  </div>
  <div class="result">
    <a class="result__a" href="/l/?uddg=https%3A%2F%2Fcrates.io">crates.io</a>
    <a class="result__snippet">The Rust community's crate registry.</a>
  </div>
</div>
</body></html>
"#;

    #[test]
    fn parses_duckduckgo_results() {
        let results = parse_duckduckgo_html(SAMPLE_DDG_HTML, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Rust Programming Language");
        assert_eq!(results[0].url, "https://example.com/rust");
        assert_eq!(
            results[0].content,
            "A systems language empowering everyone to build reliable software."
        );
        assert_eq!(results[1].url, "https://www.rust-lang.org/learn");
        assert_eq!(results[2].url, "https://crates.io");
    }

    #[test]
    fn respects_limit() {
        let results = parse_duckduckgo_html(SAMPLE_DDG_HTML, 2);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn handles_empty_html() {
        let results = parse_duckduckgo_html("<html></html>", 10);
        assert!(results.is_empty());
    }

    #[test]
    fn handles_malformed_html_without_panicking() {
        let results = parse_duckduckgo_html(
            r#"<a class="result__a" href="//duckduckgo.com/l/?uddg=https%2F%2Fbroken"#,
            10,
        );
        // Malformed entry is skipped gracefully.
        assert!(results.is_empty());
    }

    #[test]
    fn decodes_protocol_relative_and_absolute_redirects() {
        assert_eq!(
            decode_duckduckgo_redirect("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com"),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            decode_duckduckgo_redirect("/l/?uddg=https%3A%2F%2Ffoo.bar%2Fbaz"),
            Some("https://foo.bar/baz".to_string())
        );
        assert_eq!(decode_duckduckgo_redirect("https://direct.com"), None);
    }

    #[test]
    fn parses_searxng_response() {
        let json = serde_json::json!({
            "results": [
                { "title": "First", "url": "https://first.com", "content": "one" },
                { "title": "Second", "url": "https://second.com", "content": "two" }
            ]
        });
        let parsed: SearxngResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.results.len(), 2);
        assert_eq!(parsed.results[0].title, "First");
        assert_eq!(parsed.results[1].url, "https://second.com");
    }

    #[test]
    fn searxng_response_tolerates_missing_fields() {
        // All fields default to empty strings, so partial payloads parse.
        let json = serde_json::json!({ "results": [{ "title": "Only title" }] });
        let parsed: SearxngResponse = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.results.len(), 1);
        assert_eq!(parsed.results[0].title, "Only title");
        assert!(parsed.results[0].url.is_empty());
    }

    #[test]
    fn searxng_response_handles_empty_results() {
        let json = serde_json::json!({});
        let parsed: SearxngResponse = serde_json::from_value(json).unwrap();
        assert!(parsed.results.is_empty());
    }

    #[test]
    fn strip_tags_collapses_whitespace() {
        assert_eq!(strip_tags("<b>Hello</b>   <i>world</i>"), "Hello world");
    }

    #[test]
    fn resolve_backend_uses_searxng_when_url_set() {
        // SAFETY (env mutation): this test mutates the process environment and
        // must not run concurrently with other resolve_backend tests. The
        // default Rust test harness is multi-threaded, so guard with a mutex.
        let _guard = ENV_TEST_MUTEX.lock().unwrap();
        let key = SEARXNG_URL_ENV;
        let previous = std::env::var(key).ok();
        std::env::set_var(key, "http://localhost:8080");

        let http = reqwest::Client::new();
        let (_, name) = resolve_backend(http);
        assert_eq!(name, SearxngBackend::BACKEND_NAME);

        match previous {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn resolve_backend_falls_back_to_duckduckgo_when_unset() {
        let _guard = ENV_TEST_MUTEX.lock().unwrap();
        let key = SEARXNG_URL_ENV;
        let previous = std::env::var(key).ok();
        std::env::remove_var(key);

        let http = reqwest::Client::new();
        let (_, name) = resolve_backend(http);
        assert_eq!(name, DuckDuckGoBackend::BACKEND_NAME);

        if let Some(v) = previous {
            std::env::set_var(key, v);
        }
    }

    #[test]
    fn resolve_backend_falls_back_when_searxng_url_empty() {
        let _guard = ENV_TEST_MUTEX.lock().unwrap();
        let key = SEARXNG_URL_ENV;
        let previous = std::env::var(key).ok();
        std::env::set_var(key, "   ");

        let http = reqwest::Client::new();
        let (_, name) = resolve_backend(http);
        assert_eq!(name, DuckDuckGoBackend::BACKEND_NAME);

        match previous {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    // Serializes the three env-mutating resolve_backend tests. The default
    // cargo test harness runs tests in parallel, which would race on the
    // shared process environment without this lock.
    static ENV_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
}
