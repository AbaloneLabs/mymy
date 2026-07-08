export interface JsonSchemaRegistryEntry {
  id: string;
  name: string;
  schema: string;
  updatedAt: string;
}

const JSON_SCHEMA_REGISTRY_STORAGE_KEY = "mymy.documentEditor.jsonSchemaRegistry.v1";

// TODO(backend): replace browser-local persistence with a per-user schema registry API.
export function loadJsonSchemaRegistry(): JsonSchemaRegistryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(JSON_SCHEMA_REGISTRY_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .map(normalizeJsonSchemaRegistryEntry)
      .filter((entry): entry is JsonSchemaRegistryEntry => Boolean(entry))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export function saveJsonSchemaRegistry(entries: JsonSchemaRegistryEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    JSON_SCHEMA_REGISTRY_STORAGE_KEY,
    JSON.stringify(entries.map(normalizeSavedJsonSchemaRegistryEntry)),
  );
}

export function createJsonSchemaRegistryEntry(
  name: string,
  schema: string,
): JsonSchemaRegistryEntry {
  return {
    id: `schema-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizeSchemaName(name),
    schema,
    updatedAt: new Date().toISOString(),
  };
}

export function updateJsonSchemaRegistryEntry(
  entry: JsonSchemaRegistryEntry,
  name: string,
  schema: string,
): JsonSchemaRegistryEntry {
  return {
    ...entry,
    name: normalizeSchemaName(name),
    schema,
    updatedAt: new Date().toISOString(),
  };
}

export function jsonSchemaParseError(schema: string): string | null {
  if (!schema.trim()) return null;
  try {
    JSON.parse(schema);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON Schema";
  }
}

export function schemaNameFromPath(path: string) {
  const fileName = path.split("/").filter(Boolean).pop() ?? "Document";
  return `${fileName} schema`;
}

function normalizeJsonSchemaRegistryEntry(value: unknown): JsonSchemaRegistryEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.schema !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }
  return normalizeSavedJsonSchemaRegistryEntry({
    id: record.id,
    name: record.name,
    schema: record.schema,
    updatedAt: record.updatedAt,
  });
}

function normalizeSavedJsonSchemaRegistryEntry(
  entry: JsonSchemaRegistryEntry,
): JsonSchemaRegistryEntry {
  return {
    id: entry.id.trim() || createJsonSchemaRegistryEntry(entry.name, entry.schema).id,
    name: normalizeSchemaName(entry.name),
    schema: entry.schema,
    updatedAt: Number.isNaN(Date.parse(entry.updatedAt))
      ? new Date().toISOString()
      : entry.updatedAt,
  };
}

function normalizeSchemaName(name: string) {
  const normalized = name.trim();
  return normalized || "JSON Schema";
}
