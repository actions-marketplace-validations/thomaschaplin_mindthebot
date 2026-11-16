/** Nearest-rank percentile. Returns null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

export const median = (values: number[]) => percentile(values, 50);

export function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
