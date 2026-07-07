import { API_BASE } from "@/lib/api";
import type { LightweightBrowserSource } from "./components/LightweightBrowserPane";

export function apiPreviewPathHref(path: string) {
  if (path.startsWith("/api/")) {
    return `${API_BASE.replace(/\/api$/, "")}${path}`;
  }
  return `${API_BASE}${path}`;
}

export function processUrlBrowserSource(
  url: string,
  label: string,
): LightweightBrowserSource {
  return {
    kind: "process-url",
    url,
    label: label.trim() || url,
  };
}
