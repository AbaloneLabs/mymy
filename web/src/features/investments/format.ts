export function parseInteger(value: string) {
  return Math.max(0, Math.round(Number(value.replace(/,/g, "")) || 0));
}

export function parseQuantity(value: string) {
  return Math.max(0, Math.round((Number(value.replace(/,/g, "")) || 0) * 1_000_000));
}

export function formatQuantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

export function money(value?: number, currency = "KRW") {
  const amount = value ?? 0;
  return `${currency} ${amount.toLocaleString()}`;
}

export function date(value: string) {
  return new Date(value).toLocaleDateString();
}

export function allocationWidth(amount: number, total?: number) {
  if (!total || total <= 0) return 0;
  return Math.max(2, Math.min(100, (amount / total) * 100));
}
