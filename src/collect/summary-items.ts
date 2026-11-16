import { extractSeverity } from "../detect/severity.ts";

/** One issue listed in a summary comment, pointing at a file and line. */
export interface SummaryItem {
  title: string;
  text: string;
  path: string;
  line: number;
  endLine: number | null;
  severity: string | null;
}

const ITEM_START = /^(\d+[.)]|[-*])\s+/;

// `path/to/file.ts:12`, `path/to/file.ts:12-20` or `path/to/file.ts:39,63` (first line used), inside
// backticks. The path must have an extension.
const BACKTICK_REF = /`([\w@./-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?(?:,\d+(?:-\d+)?)*`/;
// A GitHub blob link: /blob/<ref>/path/to/file.ts#L12 or #L12-L20
const BLOB_LINK = /\/blob\/[^/\s)]+\/([^#\s)]+)#L(\d+)(?:-L(\d+))?/;

/**
 * Split a markdown body into list items. An item runs from its "1." or "-"
 * line until the next item, or until a non-indented line after a blank line.
 */
function listItems(body: string): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  let sawBlank = false;

  for (const line of body.split("\n")) {
    if (ITEM_START.test(line)) {
      if (current) items.push(current.join("\n"));
      current = [line];
      sawBlank = false;
      continue;
    }
    if (!current) continue;
    if (line.trim() === "") {
      sawBlank = true;
      current.push(line);
      continue;
    }
    if (sawBlank && !/^\s/.test(line)) {
      items.push(current.join("\n"));
      current = null;
      continue;
    }
    current.push(line);
  }
  if (current) items.push(current.join("\n"));
  return items;
}

function locate(text: string): { path: string; line: number; endLine: number | null } | null {
  const match = BACKTICK_REF.exec(text) ?? BLOB_LINK.exec(text);
  if (!match) return null;
  const line = Number(match[2]);
  const end = match[3] ? Number(match[3]) : null;
  return { path: decodeURIComponent(match[1]!), line, endLine: end !== null && end > line ? end : null };
}

function titleOf(text: string): string {
  const bold = /\*\*(.+?)\*\*/.exec(text);
  const raw = bold ? bold[1]! : text.replace(ITEM_START, "").split("\n")[0]!;
  return raw.trim().slice(0, 140);
}

/**
 * Extract the list items in a summary comment that point at a file and line.
 * Items without a location (general remarks, docs suggestions) are skipped:
 * there's no code to check them against.
 */
export function extractSummaryItems(body: string): SummaryItem[] {
  const result: SummaryItem[] = [];
  for (const text of listItems(body)) {
    const location = locate(text);
    if (!location) continue;
    result.push({
      title: titleOf(text),
      text,
      ...location,
      severity: extractSeverity(text.replace(ITEM_START, "")),
    });
  }
  return result;
}
