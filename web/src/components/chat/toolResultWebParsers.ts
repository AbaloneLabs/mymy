import { parseJsonObject } from "./toolResultUtils";

export interface WebSearchResult {
  query: string;
  results: WebSearchItem[];
}

export interface WebSearchItem {
  title: string;
  url: string;
  content: string;
}

export interface WebExtractResult {
  url: string;
  status?: number;
  text: string;
}

export function parseWebSearchResult(value: string): WebSearchResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const results = parsed.results;
  if (!Array.isArray(results)) return null;

  return {
    query: typeof parsed.query === "string" ? parsed.query : "",
    results: results
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item),
      )
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        url: typeof item.url === "string" ? item.url : "",
        content: typeof item.content === "string" ? item.content : "",
      }))
      .filter((item) => item.title || item.url || item.content),
  };
}

export function parseWebExtractResult(value: string): WebExtractResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const url = typeof parsed.url === "string" ? parsed.url : "";
  const status = typeof parsed.status === "number" ? parsed.status : undefined;
  if (!text && !url) return null;
  return { url, status, text };
}
