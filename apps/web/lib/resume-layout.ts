/**
 * Layout-aware PDF text extraction.
 *
 * `pdf-parse`'s default renderer walks text items in file order and inserts a newline
 * whenever the y coordinate changes. On a two-column resume that interleaves the columns:
 * a right-column "SKILLS" heading lands in the middle of a job entry, which then corrupts
 * section detection and every downstream field.
 *
 * `pdf-parse` accepts a custom `pagerender`, and the page object it hands over is a real
 * pdf.js page — so the glyph coordinates are already available. This module uses them to
 * rebuild reading order properly, with no extra dependency:
 *
 *   1. cluster text items into visual lines by their y coordinate
 *   2. find a vertical gutter that no text crosses, and if one exists read the left
 *      column fully before the right one
 *   3. drop the repeated headers/footers and page numbers that otherwise get parsed
 *      as skills or achievements
 */

/** Marks a page boundary so headers/footers can be compared across pages afterwards. */
export const PAGE_BREAK = "\f";

interface PdfTextItem {
  str: string;
  /** pdf.js transform matrix: [a, b, c, d, x, y]. */
  transform: number[];
  width?: number;
  height?: number;
}

interface PdfPageData {
  getTextContent(options?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{ items: PdfTextItem[] }>;
  view?: number[];
}

interface PositionedItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

interface Line {
  y: number;
  minX: number;
  maxX: number;
  text: string;
}

/** Items on the same visual line can drift a little; cluster within this many units. */
const LINE_TOLERANCE = 2.6;

/** A gutter narrower than this is ordinary word spacing, not a column separator. */
const MIN_GUTTER_RATIO = 0.045;

/** Columns are only considered in the middle of the page, never at the margins. */
const GUTTER_SEARCH_MIN = 0.28;
const GUTTER_SEARCH_MAX = 0.72;

/** A column holding almost nothing is a sidebar artifact, not a real column. */
const MIN_COLUMN_SHARE = 0.18;

function toPositioned(items: PdfTextItem[]): PositionedItem[] {
  return items
    .map((item) => ({
      text: item.str ?? "",
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      width: item.width ?? 0,
    }))
    .filter((item) => item.text.trim().length > 0);
}

/** Groups items into visual lines, then orders each line left to right. */
function buildLines(items: PositionedItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PositionedItem[][] = [];

  for (const item of sorted) {
    const group = groups[groups.length - 1];
    const groupY = group?.[0]?.y;
    if (group && groupY !== undefined && Math.abs(groupY - item.y) <= LINE_TOLERANCE) group.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    // Re-insert the spacing pdf.js drops between separately positioned runs.
    let text = "";
    let previousEnd: number | null = null;
    for (const item of ordered) {
      const gap = previousEnd === null ? 0 : item.x - previousEnd;
      if (previousEnd !== null && gap > 1 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += " ";
      text += item.text;
      previousEnd = item.x + item.width;
    }
    return {
      y: ordered[0].y,
      minX: ordered[0].x,
      maxX: Math.max(...ordered.map((item) => item.x + item.width)),
      text: text.replace(/\s+/g, " ").trim(),
    };
  }).filter((line) => line.text.length > 0);
}

/**
 * Finds an x position that no text crosses, splitting the page into two columns.
 * Returns null when the page is a normal single-column layout.
 */
function findGutter(lines: Line[], pageLeft: number, pageRight: number): number | null {
  const pageWidth = pageRight - pageLeft;
  if (pageWidth <= 0 || lines.length < 6) return null;

  const BUCKETS = 100;
  const occupied = new Array<boolean>(BUCKETS).fill(false);
  for (const line of lines) {
    const start = Math.max(0, Math.floor(((line.minX - pageLeft) / pageWidth) * BUCKETS));
    const end = Math.min(BUCKETS - 1, Math.ceil(((line.maxX - pageLeft) / pageWidth) * BUCKETS));
    for (let index = start; index <= end; index += 1) occupied[index] = true;
  }

  const searchStart = Math.floor(BUCKETS * GUTTER_SEARCH_MIN);
  const searchEnd = Math.ceil(BUCKETS * GUTTER_SEARCH_MAX);
  let best: { start: number; length: number } | null = null;
  let runStart: number | null = null;

  for (let index = searchStart; index <= searchEnd; index += 1) {
    if (!occupied[index]) {
      if (runStart === null) runStart = index;
      const length = index - runStart + 1;
      if (!best || length > best.length) best = { start: runStart, length };
    } else {
      runStart = null;
    }
  }

  if (!best || best.length < BUCKETS * MIN_GUTTER_RATIO) return null;
  const centre = best.start + best.length / 2;
  return pageLeft + (centre / BUCKETS) * pageWidth;
}

/** Orders lines for reading: single column as-is, two columns left block then right. */
function orderLines(lines: Line[], pageLeft: number, pageRight: number): Line[] {
  const gutter = findGutter(lines, pageLeft, pageRight);
  if (gutter === null) return lines;

  const left = lines.filter((line) => line.maxX <= gutter);
  const right = lines.filter((line) => line.minX >= gutter);
  const spanning = lines.filter((line) => line.minX < gutter && line.maxX > gutter);

  // A lopsided split usually means a decorative rule, not a real column layout.
  const share = Math.min(left.length, right.length) / lines.length;
  if (share < MIN_COLUMN_SHARE) return lines;

  // Full-width lines above the columns (name, contact block) stay at the top.
  const firstColumnY = Math.max(left[0]?.y ?? -Infinity, right[0]?.y ?? -Infinity);
  const banner = spanning.filter((line) => line.y > firstColumnY);
  const trailing = spanning.filter((line) => line.y <= firstColumnY);

  return [...banner, ...left, ...right, ...trailing];
}

/**
 * A `pagerender` for `pdf-parse` that returns layout-ordered text and marks page starts.
 */
export function renderPageWithLayout(pageData: PdfPageData): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((content) => {
      const items = toPositioned(content.items ?? []);
      if (!items.length) return PAGE_BREAK;

      const lines = buildLines(items);
      const view = pageData.view ?? [];
      const pageLeft = typeof view[0] === "number" ? view[0] : Math.min(...lines.map((line) => line.minX));
      const pageRight = typeof view[2] === "number" ? view[2] : Math.max(...lines.map((line) => line.maxX));

      const ordered = orderLines(lines, pageLeft, pageRight);

      // Restore paragraph breaks: a noticeably larger vertical gap than the body
      // leading is a real break, which is what section splitting depends on.
      const gaps = ordered.slice(1).map((line, index) => ordered[index].y - line.y).filter((gap) => gap > 0);
      const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
      const paragraphGap = median * 1.6;

      let text = PAGE_BREAK;
      ordered.forEach((line, index) => {
        if (index > 0) {
          const gap = ordered[index - 1].y - line.y;
          text += gap > paragraphGap && paragraphGap > 0 ? "\n\n" : "\n";
        }
        text += line.text;
      });
      return text;
    })
    .catch(() => PAGE_BREAK);
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function isPageNumber(value: string): boolean {
  return /^(page\s*)?#?\s*\d{1,3}(\s*(of|\/)\s*\d{1,3})?$/i.test(value.trim())
    || /^#$/.test(normalizeForComparison(value));
}

/**
 * Removes the running header/footer that repeats across pages, and any page numbers.
 *
 * Without this, a footer such as "Priya Sharma · priya@email.com · Page 2" is parsed as
 * resume content and can surface as a skill or an achievement.
 */
export function stripRepeatedHeadersAndFooters(pages: string[]): string[] {
  const cleaned = pages.map((page) => page.split("\n").map((line) => line.trim()));

  if (cleaned.length >= 2) {
    const threshold = Math.max(2, Math.ceil(cleaned.length / 2));

    const countAt = (pick: (lines: string[]) => string | undefined) => {
      const tally = new Map<string, number>();
      for (const page of cleaned) {
        const candidate = pick(page.filter(Boolean));
        if (!candidate) continue;
        const key = normalizeForComparison(candidate);
        if (!key || key.length < 3) continue;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      return tally;
    };

    const headerTally = countAt((lines) => lines[0]);
    const footerTally = countAt((lines) => lines[lines.length - 1]);

    for (const page of cleaned) {
      const firstIndex = page.findIndex(Boolean);
      if (firstIndex >= 0 && (headerTally.get(normalizeForComparison(page[firstIndex])) ?? 0) >= threshold) {
        page[firstIndex] = "";
      }
      let lastIndex = -1;
      for (let index = page.length - 1; index >= 0; index -= 1) {
        if (page[index]) { lastIndex = index; break; }
      }
      if (lastIndex >= 0 && (footerTally.get(normalizeForComparison(page[lastIndex])) ?? 0) >= threshold) {
        page[lastIndex] = "";
      }
    }
  }

  return cleaned.map((page) => page.filter((line) => !isPageNumber(line)).join("\n"));
}

/** Applies page-aware cleanup to the combined text emitted by `renderPageWithLayout`. */
export function finalizeLayoutText(raw: string): string {
  const pages = raw.split(PAGE_BREAK).map((page) => page.trim()).filter(Boolean);
  if (!pages.length) return raw.replace(new RegExp(PAGE_BREAK, "g"), "").trim();
  return stripRepeatedHeadersAndFooters(pages).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
