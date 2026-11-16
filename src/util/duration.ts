const UNITS: Record<string, number> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/** Parse "12h", "30d" or "2w" into milliseconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+)([hdw])$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use a number followed by h, d or w, e.g. 30d.`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNITS[unit!]!;
}

export function minutesBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 60_000;
}
