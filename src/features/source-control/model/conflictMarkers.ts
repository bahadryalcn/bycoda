export type ConflictSide = "ours" | "theirs" | "both";

const OURS = /^<{7}( |$)/;
const BASE = /^\|{7}( |$)/;
const SPLIT = /^={7}$/;
const THEIRS = /^>{7}( |$)/;

/** Whether the text still holds git conflict markers. */
export function hasConflictMarkers(text: string): boolean {
  // Most files have none; skip the line scan for them.
  if (!text.includes("<<<<<<<")) return false;
  return text.split("\n").some((line) => OURS.test(line.trimEnd()));
}

/**
 * A run of whole lines. `from`/`to` are character offsets and `to` includes the
 * last line's terminator, so slicing a section gives text that can be spliced
 * back as is, `\r\n` included. `startLine`/`endLine` are 1-based and inclusive;
 * an empty section has `endLine === startLine - 1`.
 */
export type ConflictSection = {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
};

export type ConflictBlock = {
  /** Start of the `<<<<<<<` line. */
  from: number;
  /** After the `>>>>>>>` line and its terminator, if it has one. */
  to: number;
  startLine: number;
  endLine: number;
  ours: ConflictSection;
  /** The diff3 common-ancestor section, when the file has one. */
  base: ConflictSection | null;
  theirs: ConflictSection;
  /** 1-based lines holding each marker. */
  markerLines: {
    ours: number;
    base: number | null;
    split: number;
    theirs: number;
  };
  /** Text after the markers: `HEAD`, a branch name, ... Empty when absent. */
  oursLabel: string;
  baseLabel: string | null;
  theirsLabel: string;
  /** False only for a closing marker that ends the file with no newline. */
  endsWithNewline: boolean;
};

type Line = {
  /** Offset of the first character. */
  from: number;
  /** Offset after the text, before any `\r\n` / `\n`. */
  to: number;
  /** Offset of the next line, or the text length for the last one. */
  next: number;
  hasBreak: boolean;
};

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from <= text.length) {
    const lf = text.indexOf("\n", from);
    if (lf < 0) {
      // A trailing newline leaves no extra empty line to speak of.
      if (from < text.length) {
        lines.push({ from, to: text.length, next: text.length, hasBreak: false });
      }
      break;
    }
    lines.push({
      from,
      to: text[lf - 1] === "\r" && lf > from ? lf - 1 : lf,
      next: lf + 1,
      hasBreak: true,
    });
    from = lf + 1;
  }
  return lines;
}

function markerOf(text: string, line: Line): string {
  return text.slice(line.from, line.to).trimEnd();
}

function labelOf(marker: string): string {
  return marker.slice(7).trim();
}

/**
 * Every well-formed conflict block, in order. The rules follow git's marker
 * syntax (`<<<<<<<`, `|||||||` and `>>>>>>>` need a space or the end of the
 * line after them, `=======` must stand alone):
 *
 * - `|||||||` only counts straight after the current side, `=======` ends the
 *   current or base side, `>>>>>>>` only ends the incoming side. Any other
 *   marker-looking line is content: a `=======` or `<<<<<<<` inside the
 *   incoming side stays part of it, and the first `>>>>>>>` after it ends it.
 * - An opening marker whose closing marker never comes is not a block; it
 *   stays plain text. A later opener never rescues it: an earlier opener that
 *   is still open takes it as content (what the whole-file resolver always did).
 */
export function findConflictBlocks(text: string): ConflictBlock[] {
  if (!text.includes("<<<<<<<")) return [];
  const lines = splitLines(text);
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!OURS.test(markerOf(text, lines[i]))) {
      i += 1;
      continue;
    }
    const block = parseBlock(text, lines, i);
    if (block) {
      blocks.push(block);
      i = block.endLine; // 1-based endLine is the index of the next line
    } else {
      i += 1;
    }
  }
  return blocks;
}

function parseBlock(text: string, lines: Line[], open: number): ConflictBlock | null {
  let base: number | null = null;
  let split: number | null = null;
  for (let j = open + 1; j < lines.length; j += 1) {
    const marker = markerOf(text, lines[j]);
    if (split === null) {
      if (base === null && BASE.test(marker)) base = j;
      else if (SPLIT.test(marker)) split = j;
    } else if (THEIRS.test(marker)) {
      const section = (first: number, last: number): ConflictSection => ({
        from: first < lines.length ? lines[first].from : text.length,
        to: last < lines.length ? lines[last].from : text.length,
        startLine: first + 1,
        endLine: last,
      });
      const last = lines[j];
      return {
        from: lines[open].from,
        to: last.next,
        startLine: open + 1,
        endLine: j + 1,
        ours: section(open + 1, base ?? split),
        base: base === null ? null : section(base + 1, split),
        theirs: section(split + 1, j),
        markerLines: {
          ours: open + 1,
          base: base === null ? null : base + 1,
          split: split + 1,
          theirs: j + 1,
        },
        oursLabel: labelOf(markerOf(text, lines[open])),
        baseLabel: base === null ? null : labelOf(markerOf(text, lines[base])),
        theirsLabel: labelOf(marker),
        endsWithNewline: last.hasBreak,
      };
    }
  }
  return null;
}

/**
 * What one block becomes when resolved: the chosen side(s) as they appear in
 * `text`, so line endings are untouched. `both` is current then incoming; the
 * diff3 base is always dropped. Splice it over `block.from..block.to`.
 */
export function conflictReplacement(
  text: string,
  block: ConflictBlock,
  side: ConflictSide,
): string {
  const ours = text.slice(block.ours.from, block.ours.to);
  const theirs = text.slice(block.theirs.from, block.theirs.to);
  const chosen = side === "ours" ? ours : side === "theirs" ? theirs : ours + theirs;
  // A file that ended on the closing marker had no final newline; keep it so.
  return block.endsWithNewline ? chosen : chosen.replace(/\r?\n$/, "");
}

/**
 * Resolve every conflict block in a file the same way. `both` keeps the
 * current side followed by the incoming one. The diff3 base section is dropped.
 * Text outside the blocks, and an unterminated block, are left as they are.
 */
export function resolveConflictMarkers(text: string, side: ConflictSide): string {
  let out = "";
  let at = 0;
  for (const block of findConflictBlocks(text)) {
    out += text.slice(at, block.from) + conflictReplacement(text, block, side);
    at = block.to;
  }
  return out + text.slice(at);
}
