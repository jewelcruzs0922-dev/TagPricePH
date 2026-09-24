export function formatPeso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH")}`;
}

export function formatDiff(amount: number): string {
  if (amount === 0) return "Best price";
  return `+₱${amount.toLocaleString("en-PH")}`;
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "-" : ""}${Math.abs(rounded)}%`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatCount(count: number): string {
  if (count >= 1000) {
    const value = count / 1000;
    const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded}k`;
  }
  return String(count);
}
