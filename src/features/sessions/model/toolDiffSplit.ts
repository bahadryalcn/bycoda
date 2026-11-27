/** Side-by-side layout of a saved unified diff; text and line numbers come only from the patch. */

export type SplitTone = "add" | "del" | "context";
export type SplitCell = { number: number; text: string; tone: SplitTone };
export type SplitRow =
  | { kind: "meta"; text: string }
  | { kind: "pair"; left: SplitCell | null; right: SplitCell | null };

/** Below this inspector width two columns of code are narrower than they are useful. */
export const SPLIT_MIN_WIDTH = 640;
/** Splitting renders two cells per line; past this the unified text node stays cheaper. */
export const SPLIT_MAX_LINES = 1200;

export type DiffLayoutChoice = "unified" | "split";

export function diffLineCount(text: string): number {
  let count = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

/** The choice is honored unless the width or size makes split poor; width 0 means not measured yet. */
export function resolveDiffLayout(
  choice: DiffLayoutChoice,
  { width, lines }: { width: number; lines: number },
): { layout: DiffLayoutChoice; splitAvailable: boolean } {
  const splitAvailable = width >= SPLIT_MIN_WIDTH && lines <= SPLIT_MAX_LINES;
  return {
    layout: choice === "split" && splitAvailable ? "split" : "unified",
    splitAvailable,
  };
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseSplitDiff(text: string): SplitRow[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  const hasHunks = lines.some((line) => HUNK.test(line));
  const rows: SplitRow[] = [];
  let removed: SplitCell[] = [];
  let added: SplitCell[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      rows.push({
        kind: "pair",
        left: removed[i] ?? null,
        right: added[i] ?? null,
      });
    removed = [];
    added = [];
  };
  // Without hunk headers (older saved previews) the whole text is one body numbered from 1.
  let oldNo = 1;
  let newNo = 1;
  let oldLeft = hasHunks ? 0 : Infinity;
  let newLeft = hasHunks ? 0 : Infinity;
  for (const line of lines) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      flush();
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      rows.push({ kind: "meta", text: line });
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) {
      flush();
      rows.push({ kind: "meta", text: line });
      continue;
    }
    const sign = line[0];
    if (sign === "\\") continue;
    const body = sign === "+" || sign === "-" || sign === " " ? line.slice(1) : line;
    if (sign === "+") {
      added.push({ number: newNo++, text: body, tone: "add" });
      newLeft--;
    } else if (sign === "-") {
      removed.push({ number: oldNo++, text: body, tone: "del" });
      oldLeft--;
    } else {
      flush();
      rows.push({
        kind: "pair",
        left: { number: oldNo++, text: body, tone: "context" },
        right: { number: newNo++, text: body, tone: "context" },
      });
      oldLeft--;
      newLeft--;
    }
  }
  flush();
  return rows;
}
