export function formatAuditTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
