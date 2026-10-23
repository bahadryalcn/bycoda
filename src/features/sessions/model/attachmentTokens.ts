import type { Attachment } from "./session";
import { parser, GFM, Subscript, Superscript, Emoji } from "@lezer/markdown";

// Match the editor's Markdown dialect without loading the editor and its DOM runtime.
const markdownParser = parser.configure([GFM, Subscript, Superscript, Emoji]);

/**
 * Inline references to a message's attachments: `[image1]`, `[file2]`.
 *
 * A token is plain text in the message. Its number is the attachment's place
 * among attachments of the same kind, in the order they were added to the
 * message, so the attachment array order is what defines every token.
 */

type TokenKind = "image" | "file";

/** The attachment a token resolves to, and where it sits in the text. */
export type TokenMatch = {
  start: number;
  end: number;
  token: string;
  /** Index into the attachment array. */
  index: number;
};

export type TextSegment =
  | { text: string }
  | { token: string; label: string; attachment: Attachment };

const TOKEN = /\[(image|file)([1-9]\d*)\]/g;
/** A token glued to a word is an index expression (`arr[image1]`), not a reference. */
const WORD_CHAR = /[\p{L}\p{N}_$]/u;

function kindOf(file: Pick<Attachment, "kind">): TokenKind {
  return file.kind === "image" ? "image" : "file";
}

/** One token per attachment, in attachment order. */
export function attachmentTokens(files: Pick<Attachment, "kind">[]): string[] {
  const counts: Record<TokenKind, number> = { image: 0, file: 0 };
  return files.map((file) => {
    const kind = kindOf(file);
    counts[kind] += 1;
    return `[${kind}${counts[kind]}]`;
  });
}

/** `[image1]` shown as `image1`. */
export function tokenLabel(token: string): string {
  return token.replace(/^\[|\]$/g, "");
}

/**
 * Tokens in `text` that refer to one of `files`.
 *
 * A token for a number no attachment has, one inside a code span or fenced
 * block, and one glued to a preceding word are ordinary text.
 */
export function findTokens(text: string, files: Pick<Attachment, "kind">[]): TokenMatch[] {
  if (!files.length || !text.includes("[")) return [];
  const indexByToken = new Map(attachmentTokens(files).map((token, index) => [token, index]));
  const code: [number, number][] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (["InlineCode", "FencedCode", "CodeBlock"].includes(node.name)) {
        code.push([node.from, node.to]);
        return false;
      }
    },
  });
  const matches: TokenMatch[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const index = indexByToken.get(match[0]);
    if (index === undefined) continue;
    const start = match.index;
    if (start > 0 && WORD_CHAR.test(text[start - 1])) continue;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    matches.push({
      start,
      end: start + match[0].length,
      token: match[0],
      index,
    });
  }
  return matches;
}

/** The text with every token that refers to one of `files` taken out. */
export function stripAttachmentTokens(text: string, files: Pick<Attachment, "kind">[]): string {
  return rewriteTokens(text, files, () => "");
}

/** The text cut into plain runs and the tokens that name an attachment. */
export function splitAttachmentTokens(text: string, files: Attachment[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let at = 0;
  for (const match of findTokens(text, files)) {
    if (match.start > at) segments.push({ text: text.slice(at, match.start) });
    segments.push({
      token: match.token,
      label: tokenLabel(match.token),
      attachment: files[match.index],
    });
    at = match.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

export type TextSelection = { start: number; end: number };

/**
 * Put `insertion` into `text` over `selection`, or at the end when the input
 * has no caret. A space goes on a side only where the neighbouring text would
 * otherwise fuse with it. Returns the new text and where the caret belongs.
 */
export function insertAtSelection(
  text: string,
  selection: TextSelection | null,
  insertion: string,
): { text: string; caret: number } {
  const start = Math.min(selection?.start ?? text.length, text.length);
  const end = Math.min(selection?.end ?? text.length, text.length);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const leading = before && !/\s$/.test(before) ? " " : "";
  const trailing = after && !/^[\s,.;:!?)]/.test(after) ? " " : "";
  const inserted = `${leading}${insertion}${trailing}`;
  return {
    text: before + inserted + after,
    caret: before.length + inserted.length,
  };
}

/** The tokens `incoming` gets when appended to `existing`, space separated. */
export function tokensForIncoming(
  existing: Pick<Attachment, "kind">[],
  incoming: Pick<Attachment, "kind">[],
): string {
  return attachmentTokens([...existing, ...incoming])
    .slice(existing.length)
    .join(" ");
}

/**
 * The text after removing the attachment at `removedIndex`: its tokens go, and
 * the tokens of the attachments left behind are renumbered so numbering stays
 * gapless. One pass over the original text, so `[image2]` becoming `[image1]`
 * can never be renamed a second time.
 */
export function removeAttachmentFromText(
  text: string,
  files: Pick<Attachment, "kind">[],
  removedIndex: number,
): string {
  if (removedIndex < 0 || removedIndex >= files.length) return text;
  const after = attachmentTokens(files.filter((_, i) => i !== removedIndex));
  return rewriteTokens(text, files, (match) => {
    if (match.index === removedIndex) return "";
    return after[match.index > removedIndex ? match.index - 1 : match.index];
  });
}

/**
 * Indices of the attachments whose token an edit took out of the text: a real
 * reference in `before` whose token text no longer appears anywhere in `after`.
 * Typing inside a token breaks it, so that counts as removing it; typing next
 * to one does not. Only meant for text the user just edited, never for a draft
 * that was restored or replaced by the app.
 */
export function attachmentsDroppedByEdit(
  before: string,
  after: string,
  files: Pick<Attachment, "kind">[],
): number[] {
  if (before === after) return [];
  const dropped = new Set<number>();
  for (const match of findTokens(before, files)) {
    if (!after.includes(match.token)) dropped.add(match.index);
  }
  return [...dropped];
}

/**
 * Backspace (`"back"`) right after a token or Delete (`"forward"`) right before
 * one takes the whole token, and one space when that would leave two in a row.
 * Null when the caret is not touching a token that way.
 */
export function deleteTokenAtCaret(
  text: string,
  caret: number,
  direction: "back" | "forward",
  files: Pick<Attachment, "kind">[],
): { text: string; caret: number } | null {
  const hit = findTokens(text, files).find((match) =>
    direction === "back" ? match.end === caret : match.start === caret,
  );
  if (!hit) return null;
  const doubled = text[hit.start - 1] === " " && text[hit.end] === " ";
  const end = hit.end + (doubled ? 1 : 0);
  return { text: text.slice(0, hit.start) + text.slice(end), caret: hit.start };
}

/**
 * Rebuild `text` with each token replaced by `replace(match)`. An empty
 * replacement removes the token along with the space it leaves doubled.
 */
function rewriteTokens(
  text: string,
  files: Pick<Attachment, "kind">[],
  replace: (match: TokenMatch) => string,
): string {
  const matches = findTokens(text, files);
  if (!matches.length) return text;
  let out = "";
  let at = 0;
  for (const match of matches) {
    out += text.slice(at, match.start);
    at = match.end;
    const replacement = replace(match);
    if (replacement) {
      out += replacement;
      continue;
    }
    const prev = out[out.length - 1];
    const next = text[at];
    const blank = (char: string | undefined) => char === " " || char === "\t";
    if (blank(next) && (blank(prev) || out === "" || prev === "\n")) {
      at += 1;
    } else if (blank(prev) && (next === undefined || /[\n,.;:!?)]/.test(next))) {
      out = out.slice(0, -1);
    }
  }
  return out + text.slice(at);
}

function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * The line that tells a model what each token in the message stands for.
 *
 * Images reach most providers as separate content blocks with no name, so the
 * ordinal tells the model which block a token means; files travel as paths,
 * which are named outright. Empty when the message has no attachments.
 */
export function attachmentLegend(files: Attachment[]): string {
  if (!files.length) return "";
  const tokens = attachmentTokens(files);
  let images = 0;
  const entries = files.map((file, index) => {
    if (kindOf(file) === "image") {
      images += 1;
      return `${tokens[index]} = ${legendName(file.name)} (${ordinal(images)} attached image)`;
    }
    return `${tokens[index]} = ${legendName(file.path || file.name)}`;
  });
  return `Attachments: ${entries.join(", ")}`;
}

function legendName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}
