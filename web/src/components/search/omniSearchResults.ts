import type { WorkspaceSearchHit } from "@/types/search";

export function workspaceSearchHitKey(hit: WorkspaceSearchHit) {
  return `${hit.domain}:${hit.resourceKind}:${hit.stableId}`;
}

export function workspaceSearchHitRoute(hit: WorkspaceSearchHit) {
  const id = hit.sourceLink.id ?? hit.stableId;
  switch (hit.sourceLink.kind) {
    case "note":
      return `/notes?noteId=${encodeURIComponent(id)}`;
    case "task":
      return `/tasks?taskId=${encodeURIComponent(id)}`;
    case "project":
      return `/projects/${encodeURIComponent(id)}`;
    case "calendar_event":
      return `/calendar?eventId=${encodeURIComponent(id)}${
        hit.freshness ? `&date=${encodeURIComponent(hit.freshness)}` : ""
      }`;
    case "chat_session":
      return `/chat?sessionId=${encodeURIComponent(id)}`;
    case "knowledge":
      return `/knowledge?id=${encodeURIComponent(id)}`;
    case "drive": {
      const path = hit.sourceLink.path;
      if (path?.startsWith("/drive/")) {
        return `/drive?file=${encodeURIComponent(path)}`;
      }
      return "/drive";
    }
    default:
      return fallbackRoute(hit.domain);
  }
}

function fallbackRoute(domain: WorkspaceSearchHit["domain"]) {
  switch (domain) {
    case "notes":
      return "/notes";
    case "tasks":
      return "/tasks";
    case "projects":
      return "/";
    case "calendar":
      return "/calendar";
    case "sessions":
      return "/chat";
    case "knowledge":
      return "/knowledge";
    case "drive":
      return "/drive";
  }
}
