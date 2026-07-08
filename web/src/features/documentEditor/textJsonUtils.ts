import { isRecord } from "./models";

/**
 * JSON document editing uses the same path and value manipulation rules in the
 * tree, table, preview, and command handlers. Keeping those rules outside the
 * React editor prevents UI state changes from carrying hidden data-model
 * behavior, and gives future document editors one canonical place to extend JSON
 * coercion, table projection, and path mutation semantics.
 */
export type JsonPathSegment = string | number;

export interface JsonTableRow {
  key?: string;
  value: Record<string, unknown>;
}

export interface JsonTableModel {
  kind: "array" | "object";
  rows: JsonTableRow[];
  columns: string[];
}

export function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}

export function jsonPathsEqual(left: JsonPathSegment[], right: JsonPathSegment[]) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function parentJsonPath(path: JsonPathSegment[]) {
  return path.slice(0, Math.max(0, path.length - 1));
}

export function jsonPathLabel(path: JsonPathSegment[]) {
  if (path.length === 0) return "$";
  return path.reduce(
    (label, segment) =>
      typeof segment === "number" ? `${label}[${segment}]` : `${label}.${segment}`,
    "$",
  );
}

export function getJsonPathValue(value: unknown, path: JsonPathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === "string") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function jsonPathExists(value: unknown, path: JsonPathSegment[]) {
  if (path.length === 0) return true;
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number" && segment in current) {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === "string" && segment in current) {
      current = current[segment];
    } else {
      return false;
    }
  }
  return true;
}

export function setJsonPathValue(
  value: unknown,
  path: JsonPathSegment[],
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const [segment, ...rest] = path;
  if (Array.isArray(value) && typeof segment === "number") {
    return value.map((item, index) =>
      index === segment ? setJsonPathValue(item, rest, nextValue) : item,
    );
  }
  if (isRecord(value) && typeof segment === "string") {
    return {
      ...value,
      [segment]: setJsonPathValue(value[segment], rest, nextValue),
    };
  }
  return value;
}

export function deleteJsonPathValue(value: unknown, path: JsonPathSegment[]): unknown {
  if (path.length === 0) return value;
  if (path.length === 1) {
    const [segment] = path;
    if (Array.isArray(value) && typeof segment === "number") {
      return value.filter((_, index) => index !== segment);
    }
    if (isRecord(value) && typeof segment === "string") {
      const next = { ...value };
      delete next[segment];
      return next;
    }
    return value;
  }
  const [segment, ...rest] = path;
  if (Array.isArray(value) && typeof segment === "number") {
    return value.map((item, index) =>
      index === segment ? deleteJsonPathValue(item, rest) : item,
    );
  }
  if (isRecord(value) && typeof segment === "string") {
    return {
      ...value,
      [segment]: deleteJsonPathValue(value[segment], rest),
    };
  }
  return value;
}

export function firstJsonChildPathSegment(value: unknown): JsonPathSegment | null {
  if (Array.isArray(value)) return value.length > 0 ? 0 : null;
  if (isRecord(value)) return Object.keys(value)[0] ?? null;
  return null;
}

export function insertJsonObjectEntry(
  value: Record<string, unknown>,
  afterKey: string,
  key: string,
  insertedValue: unknown,
) {
  const entries = Object.entries(value);
  const result: Record<string, unknown> = {};
  let inserted = false;
  for (const [entryKey, entryValue] of entries) {
    result[entryKey] = entryValue;
    if (entryKey === afterKey) {
      result[key] = insertedValue;
      inserted = true;
    }
  }
  if (!inserted) result[key] = insertedValue;
  return result;
}

export function jsonEditorValueType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

export function coerceJsonEditorValue(value: unknown, nextType: string): unknown {
  if (nextType === "object") return isRecord(value) ? value : {};
  if (nextType === "array") return Array.isArray(value) ? value : [];
  if (nextType === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
  }
  if (nextType === "boolean") return Boolean(value);
  if (nextType === "null") return null;
  return typeof value === "string" ? value : String(value ?? "");
}

export function jsonPrimitiveClass(value: unknown) {
  if (typeof value === "string") return "text-[var(--status-success)]";
  if (typeof value === "number") return "text-[var(--accent)]";
  if (typeof value === "boolean") return "text-[var(--status-warning)]";
  if (value === null) return "text-[var(--text-faint)]";
  return "text-[var(--text-muted)]";
}

export function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content || "null");
  } catch {
    return undefined;
  }
}

export function isTabularJson(value: unknown) {
  return tabularJsonModel(value) !== null;
}

export function tabularJsonModel(value: unknown): JsonTableModel | null {
  if (Array.isArray(value) && value.every((item) => isRecord(item))) {
    const records = value as Array<Record<string, unknown>>;
    return {
      kind: "array",
      rows: records.map((row) => ({ value: row })),
      columns: jsonTableColumns(records),
    };
  }
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => isRecord(item))) return null;
  const records = entries.map(([, item]) => item as Record<string, unknown>);
  return {
    kind: "object",
    rows: entries.map(([key, item]) => ({
      key,
      value: item as Record<string, unknown>,
    })),
    columns: jsonTableColumns(records),
  };
}

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  );
}

export function jsonTableColumns(rows: Array<Record<string, unknown>>) {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return Array.from(columns);
}

export function jsonCellToString(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function parseJsonCell(value: string, previous: unknown) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (typeof previous === "number" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}
