export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function toCamel(s: string): string {
  return s
    .split("_")
    .map((part) => capitalize(part))
    .join("");
}

export function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  }
  return Number.isInteger(v)
    ? v.toLocaleString("en")
    : v.toLocaleString("en", { maximumFractionDigits: 2 });
}
