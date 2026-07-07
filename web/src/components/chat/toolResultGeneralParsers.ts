import {
  booleanValue,
  jsonScalarSummary,
  numberValue,
  parseJsonObject,
  recordValue,
  recordsValue,
  stringArrayValue,
  stringValue,
} from "./toolResultUtils";

/**
 * General tool-result parsers normalize JSON payloads before rendering. The
 * chat UI should decide presentation, while this module owns the loose wire
 * formats emitted by tools so each schema can evolve without adding parsing
 * branches to the renderer component.
 */
export interface ReadFileResult {
  path: string;
  content: string;
  totalLines?: number;
  shownStart?: number;
  shownEnd?: number;
}

export interface SearchFilesResult {
  matches: SearchFileMatch[];
}

export interface SearchFileMatch {
  path: string;
  line?: number;
  preview: string;
}

export interface FileMutationResult {
  path: string;
  bytesWritten?: number;
  linesWritten?: number;
  replacements?: number;
}

export interface TodoResult {
  success: boolean;
  todos: ToolTodo[];
}

export interface ToolTodo {
  id: string;
  content: string;
  status: string;
}

export type SessionSearchResult =
  | { mode: "discovery"; results: SessionSearchItem[] }
  | { mode: "browse"; sessions: SessionSearchItem[] }
  | { mode: "scroll"; sessionId: string; window: SessionSearchItem[] };

export interface SessionSearchItem {
  sessionId?: string;
  messageId?: string;
  title?: string;
  role?: string;
  snippet?: string;
  preview?: string;
  content?: string;
  timestamp?: string;
}

export interface SkillsListResult {
  count: number;
  root: string;
  hint: string;
  categories: string[];
  skills: ToolSkill[];
}

export interface ToolSkill {
  name: string;
  description: string;
  category: string;
}

export interface SkillViewResult {
  usageHint: string;
  skill: Record<string, unknown>;
}

export interface SkillBundleResult {
  success: boolean;
  bundles: ToolBundle[];
  bundle?: string;
  message?: string;
  instruction?: string;
}

export interface ToolBundle {
  name: string;
  description: string;
  skills: string[];
}

export interface OperationResult {
  success?: boolean;
  result?: unknown;
  summary: [string, string][];
}

export interface PreviewResult {
  id: string;
  label: string;
  targetUrl: string;
  previewPath: string;
}

export interface InvestmentSnapshotResult {
  summary: Record<string, unknown>;
  positions: Record<string, unknown>[];
  watchlist: Record<string, unknown>[];
}

export interface CronResult {
  success?: boolean;
  jobs: Record<string, unknown>[];
  blueprints: Record<string, unknown>[];
  skills: string[];
  job?: Record<string, unknown>;
  summary: [string, string][];
}

export interface ExtensionsStatusResult {
  success?: boolean;
  extensions: Record<string, unknown>[];
}

export interface McpResult {
  success?: boolean;
  server?: string;
  tool?: string;
  servers: Record<string, unknown>[];
  result?: unknown;
}

export function parseReadFileResult(value: string): ReadFileResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const path = stringValue(parsed, "path");
  const content = stringValue(parsed, "content");
  if (!path && !content) return null;
  return {
    path,
    content,
    totalLines: numberValue(parsed, "total_lines", "totalLines"),
    shownStart: numberValue(parsed, "shown_start", "shownStart"),
    shownEnd: numberValue(parsed, "shown_end", "shownEnd"),
  };
}

export function parseSearchFilesResult(value: string): SearchFilesResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.matches)) return null;
  return {
    matches: recordsValue(parsed, "matches").map((match) => ({
      path: stringValue(match, "path"),
      line: numberValue(match, "line"),
      preview: stringValue(match, "preview", "text", "lineText"),
    })),
  };
}

export function parseFileMutationResult(value: string): FileMutationResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const path = stringValue(parsed, "path");
  if (!path) return null;
  return {
    path,
    bytesWritten: numberValue(parsed, "bytes_written", "bytesWritten"),
    linesWritten: numberValue(parsed, "lines_written", "linesWritten"),
    replacements: numberValue(parsed, "replacements"),
  };
}

export function isDocumentEditorPath(path: string) {
  return /\.(md|markdown|txt|log|json|ya?ml|toml|csv|tsv|css|mjs|cjs|jsx?|tsx?|rs|py|sh|docx|xlsx|pptx)$/i.test(
    path,
  );
}

export function isHtmlPreviewPath(path: string) {
  return /\.html?$/i.test(path);
}

export function parseTodoResult(value: string): TodoResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.todos)) return null;
  return {
    success: booleanValue(parsed, "success") ?? false,
    todos: recordsValue(parsed, "todos").map((todo) => ({
      id: stringValue(todo, "id"),
      content: stringValue(todo, "content"),
      status: stringValue(todo, "status"),
    })),
  };
}

export function parseSessionSearchResult(value: string): SessionSearchResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const mode = stringValue(parsed, "mode");
  if (mode === "discovery") {
    return {
      mode,
      results: recordsValue(parsed, "results").map(parseSessionSearchItem),
    };
  }
  if (mode === "browse") {
    return {
      mode,
      sessions: recordsValue(parsed, "sessions").map(parseSessionSearchItem),
    };
  }
  if (mode === "scroll") {
    return {
      mode,
      sessionId: stringValue(parsed, "session_id", "sessionId"),
      window: recordsValue(parsed, "window").map(parseSessionSearchItem),
    };
  }
  return null;
}

function parseSessionSearchItem(value: Record<string, unknown>): SessionSearchItem {
  return {
    sessionId: stringValue(value, "session_id", "sessionId"),
    messageId: stringValue(value, "message_id", "messageId", "id"),
    title: stringValue(value, "title"),
    role: stringValue(value, "role"),
    snippet: stringValue(value, "snippet"),
    preview: stringValue(value, "preview"),
    content: stringValue(value, "content"),
    timestamp: stringValue(value, "timestamp", "created_at", "createdAt"),
  };
}

export function parseSkillsListResult(value: string): SkillsListResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.skills)) return null;
  const skills = recordsValue(parsed, "skills").map((skill) => ({
    name: stringValue(skill, "name"),
    description: stringValue(skill, "description"),
    category: stringValue(skill, "category"),
  }));
  return {
    count: numberValue(parsed, "count") ?? skills.length,
    root: stringValue(parsed, "root"),
    hint: stringValue(parsed, "hint"),
    categories: stringArrayValue(parsed, "categories"),
    skills,
  };
}

export function parseSkillViewResult(value: string): SkillViewResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const skill = recordValue(parsed, "skill");
  if (!skill) return null;
  return {
    usageHint: stringValue(parsed, "usage_hint", "usageHint"),
    skill,
  };
}

export function parseSkillBundleResult(value: string): SkillBundleResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const bundleRecord = recordValue(parsed, "bundle");
  const bundles = recordsValue(parsed, "bundles");
  if (!bundleRecord && bundles.length === 0 && !("message" in parsed) && !("instruction" in parsed)) {
    return null;
  }
  const normalizedBundles = [
    ...bundles,
    ...(bundleRecord ? [bundleRecord] : []),
  ].map((bundle) => ({
    name: stringValue(bundle, "name"),
    description: stringValue(bundle, "description"),
    skills: stringArrayValue(bundle, "skills"),
  }));
  return {
    success: booleanValue(parsed, "success") ?? false,
    bundles: normalizedBundles,
    bundle: typeof parsed.bundle === "string" ? parsed.bundle : undefined,
    message: stringValue(parsed, "message"),
    instruction: stringValue(parsed, "instruction"),
  };
}

export function parseOperationResult(value: string): OperationResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const result = parsed.result;
  const summary = jsonScalarSummary(parsed)
    .filter(([key]) => key !== "injection")
    .slice(0, 8);
  if (summary.length === 0 && result === undefined) return null;
  return {
    success: booleanValue(parsed, "success"),
    result,
    summary,
  };
}

export function parsePreviewResult(value: string): PreviewResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const previewPath = stringValue(parsed, "preview_path", "previewPath");
  const targetUrl = stringValue(parsed, "target_url", "targetUrl");
  if (!previewPath && !targetUrl) return null;
  return {
    id: stringValue(parsed, "id"),
    label: stringValue(parsed, "label"),
    targetUrl,
    previewPath,
  };
}

export function parseInvestmentSnapshotResult(value: string): InvestmentSnapshotResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const summary = recordValue(parsed, "summary");
  if (!summary) return null;
  return {
    summary,
    positions: recordsValue(parsed, "positions"),
    watchlist: recordsValue(parsed, "watchlist"),
  };
}

export function parseCronResult(value: string): CronResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const jobs = recordsValue(parsed, "jobs");
  const blueprints = recordsValue(parsed, "blueprints");
  const job = recordValue(parsed, "job");
  const skills = stringArrayValue(parsed, "skills");
  const summary = jsonScalarSummary(parsed);
  if (jobs.length === 0 && blueprints.length === 0 && !job && skills.length === 0 && summary.length === 0) {
    return null;
  }
  return {
    success: booleanValue(parsed, "success"),
    jobs,
    blueprints,
    skills,
    job: job ?? undefined,
    summary,
  };
}

export function parseExtensionsStatusResult(value: string): ExtensionsStatusResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.extensions)) return null;
  return {
    success: booleanValue(parsed, "success"),
    extensions: recordsValue(parsed, "extensions"),
  };
}

export function parseMcpResult(value: string): McpResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const servers = recordsValue(parsed, "servers");
  if (servers.length === 0 && !("result" in parsed) && !("server" in parsed)) return null;
  return {
    success: booleanValue(parsed, "success"),
    server: stringValue(parsed, "server"),
    tool: stringValue(parsed, "tool"),
    servers,
    result: parsed.result,
  };
}

export function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
