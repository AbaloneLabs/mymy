export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function recordValue(
  object: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = object[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

export function recordsValue(object: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      );
    }
  }
  return [];
}

export function stringValue(object: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

export function firstString(object: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(object, key);
    if (value) return value;
  }
  return "";
}

export function numberValue(
  object: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function booleanValue(
  object: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

export function stringArrayValue(object: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "number" || typeof item === "boolean") return String(item);
          return "";
        })
        .filter(Boolean);
    }
  }
  return [];
}

export function numberArrayValue(object: Record<string, unknown>, ...keys: string[]): number[] {
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "number" && Number.isFinite(item)) return item;
          if (typeof item === "string") {
            const parsed = Number(item);
            if (Number.isFinite(parsed)) return parsed;
          }
          return undefined;
        })
        .filter((item): item is number => item !== undefined);
    }
  }
  return [];
}

export function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function jsonScalarSummary(object: Record<string, unknown>): [string, string][] {
  return Object.entries(object)
    .filter((entry) => isScalar(entry[1]))
    .map(([key, value]) => [key, String(value)] as [string, string])
    .slice(0, 10);
}

