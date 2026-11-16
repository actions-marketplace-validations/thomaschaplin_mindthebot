/**
 * Parse a unified diff patch and return the line numbers on the *old* side that
 * were touched. A deleted or replaced line counts as touched. A pure insertion
 * counts as touching the old line it was inserted after (and the one before it,
 * so an insertion at the very top of a file still registers).
 */
export function touchedOldLines(patch: string): number[] {
  const touched = new Set<number>();
  let oldLine = 0;
  let inHunk = false;
  // True right after deleted lines: "+" lines there replace them rather than insert.
  let afterDeletion = false;

  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      inHunk = true;
      afterDeletion = false;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith("-")) {
      touched.add(oldLine);
      oldLine += 1;
      afterDeletion = true;
    } else if (line.startsWith("+")) {
      if (!afterDeletion) {
        // A pure insertion between oldLine - 1 and oldLine.
        touched.add(Math.max(oldLine - 1, 1));
        touched.add(oldLine);
      }
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file": not a line.
    } else {
      oldLine += 1;
      afterDeletion = false;
    }
  }
  return [...touched].sort((a, b) => a - b);
}

/** True if any touched line is within `proximity` lines of `line`. */
export function isNear(touched: number[], line: number, proximity: number): boolean {
  return touched.some((t) => Math.abs(t - line) <= proximity);
}
