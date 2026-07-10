import type {
  DelegateResult,
  DelegateTaskResult,
} from "./toolResultDelegate";

export function parseDelegateResult(value: string): DelegateResult | null {
  try {
    const parsed = JSON.parse(value) as Partial<DelegateResult>;
    if (!Array.isArray(parsed.results)) return null;
    const results = parsed.results.filter(
      (item): item is DelegateTaskResult =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.index === "number" &&
        typeof item.goal === "string" &&
        typeof item.status === "string",
    );
    return { success: parsed.success === true, results };
  } catch {
    return null;
  }
}
