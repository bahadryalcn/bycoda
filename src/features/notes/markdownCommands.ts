export type MarkdownCommand =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "bullet"
  | "numbered"
  | "checklist"
  | "quote"
  | "code"
  | "link"
  | "table"
  | "rule";

/** Replace `from..to` with `insert`, then select `anchor..head` in the result. */
export type MarkdownEdit = {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
};

export function markdownEdit(
  command: MarkdownCommand,
  doc: string,
  from: number,
  to: number,
): MarkdownEdit {
  const start = Math.max(0, Math.min(from, to, doc.length));
  const end = Math.min(doc.length, Math.max(from, to));
  switch (command) {
    case "bold":
      return toggleInline(doc, start, end, "**");
    case "italic":
      return toggleInline(doc, start, end, "*");
    case "strike":
      return toggleInline(doc, start, end, "~~");
    case "heading":
      return editLines(doc, start, end, cycleHeading);
    case "bullet":
      return editLines(doc, start, end, (lines) => toggleList(lines, "bullet"));
    case "numbered":
      return editLines(doc, start, end, (lines) => toggleList(lines, "numbered"));
    case "checklist":
      return editLines(doc, start, end, (lines) => toggleList(lines, "checklist"));
    case "quote":
      return editLines(doc, start, end, toggleQuote);
    case "code":
      return toggleCode(doc, start, end);
    case "link":
      return insertLink(doc, start, end);
    case "table":
      return insertBlock(doc, start, end, TABLE, "Column");
    case "rule":
      return insertBlock(doc, start, end, "---");
  }
}

function runLength(doc: string, pos: number, step: 1 | -1, char: string) {
  let count = 0;
  for (let index = step === 1 ? pos : pos - 1; doc[index] === char; index += step) {
    count += 1;
  }
  return count;
}

// A single marker must not read one half of a doubled one (`*` inside `**`).
function runMatches(run: number, size: number) {
  return size === 1 ? run === 1 || run >= 3 : run >= size;
}

function toggleInline(doc: string, from: number, to: number, marker: string): MarkdownEdit {
  // Markers hugging whitespace do not render, so wrap the words only.
  const raw = doc.slice(from, to);
  if (raw.trim()) {
    from += raw.length - raw.trimStart().length;
    to -= raw.length - raw.trimEnd().length;
  }
  const selected = doc.slice(from, to);
  const size = marker.length;
  const char = marker[0]!;

  const outside = Math.min(runLength(doc, from, -1, char), runLength(doc, to, 1, char));
  if (runMatches(outside, size)) {
    return {
      from: from - size,
      to: to + size,
      insert: selected,
      anchor: from - size,
      head: to - size,
    };
  }

  const inside = Math.min(
    runLength(selected, 0, 1, char),
    runLength(selected, selected.length, -1, char),
  );
  if (selected.length > size * 2 && runMatches(inside, size)) {
    const insert = selected.slice(size, -size);
    return { from, to, insert, anchor: from, head: from + insert.length };
  }

  return {
    from,
    to,
    insert: `${marker}${selected}${marker}`,
    anchor: from + size,
    head: to + size,
  };
}

/** `text` is the rewritten line; `rest` is the part of it the user wrote. */
type EditedLine = { text: string; rest: string };

function editLines(
  doc: string,
  from: number,
  to: number,
  edit: (lines: string[]) => EditedLine[],
): MarkdownEdit {
  // A selection ending at a line start does not include that line.
  const last = to > from && doc[to - 1] === "\n" ? to - 1 : to;
  const start = from === 0 ? 0 : doc.lastIndexOf("\n", from - 1) + 1;
  const nextBreak = doc.indexOf("\n", last);
  const end = nextBreak === -1 ? doc.length : nextBreak;
  const lines = doc.slice(start, end).split("\n");
  const edited = edit(lines);
  const insert = edited.map((line) => line.text).join("\n");

  if (from !== to) {
    return {
      from: start,
      to: end,
      insert,
      anchor: start,
      head: start + insert.length,
    };
  }
  // Keep the caret on the same character, or just after a new prefix.
  const { text, rest } = edited[0]!;
  const fromEnd = Math.min(end - from, rest.length);
  const cursor = start + text.length - fromEnd;
  return { from: start, to: end, insert, anchor: cursor, head: cursor };
}

function isTarget(line: string, lines: string[]) {
  return lines.length === 1 || line.trim() !== "";
}

const HEADING = /^(#{1,6})[ \t]+(.*)$/;

function cycleHeading(lines: string[]): EditedLine[] {
  const first = lines.find((line) => isTarget(line, lines)) ?? "";
  const level = HEADING.exec(first)?.[1]?.length ?? 0;
  const next = level >= 3 ? 0 : level + 1;
  return lines.map((line) => {
    if (!isTarget(line, lines)) return { text: line, rest: line };
    const rest = HEADING.exec(line)?.[2] ?? line.replace(/^#{1,6}$/, "");
    return { text: next ? `${"#".repeat(next)} ${rest}` : rest, rest };
  });
}

type ListKind = "bullet" | "numbered" | "checklist";

const LIST_LINE = /^(\s*)((?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )?)(.*)$/;

function listKind(marker: string): ListKind | null {
  if (!marker) return null;
  if (marker.includes("[")) return "checklist";
  return /^\d/.test(marker) ? "numbered" : "bullet";
}

function toggleList(lines: string[], kind: ListKind): EditedLine[] {
  const parts = lines.map((line) => {
    const match = LIST_LINE.exec(line)!;
    return { indent: match[1]!, marker: match[2]!, rest: match[3]! };
  });
  const targets = lines.map((line) => isTarget(line, lines));
  const remove = parts.every((part, index) => !targets[index] || listKind(part.marker) === kind);
  let number = 0;
  return lines.map((line, index) => {
    const { indent, marker, rest } = parts[index]!;
    if (!targets[index]) return { text: line, rest: line };
    if (remove) return { text: `${indent}${rest}`, rest };
    number += 1;
    const prefix =
      kind === "bullet"
        ? "- "
        : kind === "numbered"
          ? `${number}. `
          : listKind(marker) === "checklist"
            ? marker
            : "- [ ] ";
    return { text: `${indent}${prefix}${rest}`, rest };
  });
}

const QUOTE = /^(\s*)> ?(.*)$/;

function toggleQuote(lines: string[]): EditedLine[] {
  const remove = lines.every((line) => QUOTE.test(line));
  return lines.map((line) => {
    if (!remove) return { text: `> ${line}`, rest: line };
    const match = QUOTE.exec(line)!;
    const rest = match[2]!;
    return { text: `${match[1]}${rest}`, rest };
  });
}

function toggleCode(doc: string, from: number, to: number): MarkdownEdit {
  const selected = doc.slice(from, to);
  // Part of one line reads as inline code; anything else gets a fenced block.
  if (selected && !selected.includes("\n")) {
    return toggleInlineCode(doc, from, to);
  }
  const fence = "`".repeat(Math.max(3, longestBacktickRun(selected) + 1));
  const before = from > 0 && doc[from - 1] !== "\n" ? "\n" : "";
  const after = to < doc.length && doc[to] !== "\n" ? "\n" : "";
  const open = `${before}${fence}\n`;
  const anchor = from + open.length;
  return {
    from,
    to,
    insert: `${open}${selected}\n${fence}${after}`,
    anchor,
    head: anchor + selected.length,
  };
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function toggleInlineCode(doc: string, from: number, to: number): MarkdownEdit {
  const selected = doc.slice(from, to);
  // A toolbar-created selection excludes both delimiters and any required padding.
  for (const padding of [0, 1]) {
    if (padding && (doc[from - 1] !== " " || doc[to] !== " ")) continue;
    const left = runLength(doc, from - padding, -1, "`");
    const right = runLength(doc, to + padding, 1, "`");
    if (left && left === right && left > longestBacktickRun(selected)) {
      const start = from - padding - left;
      return {
        from: start,
        to: to + padding + right,
        insert: selected,
        anchor: start,
        head: start + selected.length,
      };
    }
  }
  const left = runLength(selected, 0, 1, "`");
  const right = runLength(selected, selected.length, -1, "`");
  if (left && left === right && selected.length > left * 2) {
    let content = selected.slice(left, -right);
    if (left > longestBacktickRun(content)) {
      // CommonMark removes one padding space from each end, except for all-space spans.
      if (content.startsWith(" ") && content.endsWith(" ") && content.trim()) {
        content = content.slice(1, -1);
      }
      return { from, to, insert: content, anchor: from, head: from + content.length };
    }
  }
  const marker = "`".repeat(longestBacktickRun(selected) + 1);
  const padded =
    selected.startsWith("`") ||
    selected.endsWith("`") ||
    (selected.startsWith(" ") && selected.endsWith(" ") && selected.trim() !== "");
  const padding = padded ? " " : "";
  const anchor = from + marker.length + padding.length;
  return {
    from,
    to,
    insert: `${marker}${padding}${selected}${padding}${marker}`,
    anchor,
    head: anchor + selected.length,
  };
}

function insertLink(doc: string, from: number, to: number): MarkdownEdit {
  const selected = doc.slice(from, to);
  if (/^(https?:\/\/|www\.)\S+$/.test(selected)) {
    return {
      from,
      to,
      insert: `[text](${selected.startsWith("www.") ? `https://${selected}` : selected})`,
      anchor: from + 1,
      head: from + 5,
    };
  }
  if (!selected) {
    return { from, to, insert: "[text](url)", anchor: from + 1, head: from + 5 };
  }
  const label = selected.replace(/[\\[\]]/g, "\\$&");
  const anchor = from + label.length + 3;
  return {
    from,
    to,
    insert: `[${label}](url)`,
    anchor,
    head: anchor + 3,
  };
}

const TABLE = "| Column | Column |\n| --- | --- |\n|  |  |";

/** Put `block` on its own paragraph, selecting `select` inside it if given. */
function insertBlock(
  doc: string,
  from: number,
  to: number,
  block: string,
  select?: string,
): MarkdownEdit {
  const before = doc.slice(0, from);
  const after = doc.slice(to);
  const leading = !before
    ? ""
    : before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const trailing = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const insert = `${leading}${block}${trailing}`;
  const offset = select ? block.indexOf(select) : -1;
  if (offset >= 0) {
    const anchor = from + leading.length + offset;
    return { from, to, insert, anchor, head: anchor + select!.length };
  }
  const cursor = from + insert.length;
  return { from, to, insert, anchor: cursor, head: cursor };
}
