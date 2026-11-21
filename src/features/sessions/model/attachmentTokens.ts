import type { Attachment } from "./session";
import { formatAttachmentSize } from "./attachmentPresentation";
import { parser, GFM, Subscript, Superscript, Emoji } from "@lezer/markdown";

// Match the editor's Markdown dialect without loading the editor and its DOM runtime.
const markdownParser = parser.configure([GFM, Subscript, Superscript, Emoji]);

/**
 * Inline references to a message's attachments: `[Image 1 · 54 KB]`, `[File 2 · 5 KB]`,
 * joined with no-break spaces.
 *
 * A token is plain text in the message. Its number is the attachment's place
 * among attachments of the same kind, in the order they were added to the
 * message, so the attachment array order is what defines every token. The size
 * uses the locale-independent attachment format so a token never changes under
 * a draft. Messages sent before sizes were added use `[image1]`, still recognized.
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
  | { token: string; label: string; attachment: Attachment; fullName?: true };

// Candidates only; a match counts when it equals an expected token. `quote` tokens
// name chat citations (citationTokens.ts) and share this matcher.
const TOKEN = /\[(?:Image|File): [^[\]\r\n]{1,256}; ref=[\w-]{1,100}\]|\[[^[\]\r\n]+\]/g;
const NAMED_REFERENCE = /\[(Image|File): ([^[\]\r\n]{1,256}); ref=([\w-]{1,100})\]/g;
/** A token glued to a word is an index expression (`arr[image1]`), not a reference. */
const WORD_CHAR = /[\p{L}\p{N}_$]/u;

function kindOf(file: Pick<Attachment, "kind">): TokenKind {
  return file.kind === "image" ? "image" : "file";
}

type TokenFile = Pick<Attachment, "kind" | "size"> & Partial<Pick<Attachment, "id" | "name">>;
const NBSP = "\u00a0";

/** One token per attachment, in attachment order. */
export function attachmentTokens(files: TokenFile[]): string[] {
  const counts: Record<TokenKind, number> = { image: 0, file: 0 };
  return files.map((file) => {
    const kind = kindOf(file);
    counts[kind] += 1;
    // No-break spaces: a token never wraps, so its overlay face stays on one line.
    const words = [kind === "image" ? "Image" : "File", String(counts[kind])];
    const size = formatAttachmentSize(file.size);
    if (size) words.push("·", size.replace(" ", NBSP));
    return `[${words.join(NBSP)}]`;
  });
}

/** The draft carries each filename's width in the textarea's own line layout. */
export function attachmentDraftTokens(files: TokenFile[]): string[] {
  return attachmentTokens(files).map((token, index) => {
    const name = files[index].name;
    if (!name) return token;
    // Keep filenames literal to draft Markdown, skill, link and mention scanners.
    const sourceName = name.replace(/[[\]\r\n/$@`*_~<>]/g, (character) =>
      character === "\r" || character === "\n"
        ? " "
        : String.fromCharCode(character.charCodeAt(0) + 0xfee0),
    );
    const size = token.indexOf(`${NBSP}·`);
    const at = size < 0 ? token.length - 1 : size;
    return `${token.slice(0, at)}${NBSP}·${NBSP}${sourceName}${token.slice(at)}`;
  });
}

/** Restored short references expand only when their attachment is available. */
export function expandAttachmentDraftTokens(text: string, files: TokenFile[]): string {
  const matches = findTokens(text, files);
  if (matches.length === 0) return text;
  const drafts = attachmentDraftTokens(files);
  return rewriteTokenMatches(text, matches, (match) => drafts[match.index]);
}

/** Keep the existing reference spelling at the delivery boundary. */
export function compactAttachmentDraftTokens(text: string, files: TokenFile[]): string {
  const matches = findTokens(text, files);
  if (matches.length === 0) return text;
  const drafts = attachmentDraftTokens(files);
  const compact = attachmentTokens(files);
  return rewriteTokenMatches(text, matches, (match) =>
    match.token === drafts[match.index] ? compact[match.index] : match.token,
  );
}

/** The pre-size `[image1]` form, recognized in older messages and drafts. */
function legacyAttachmentTokens(files: TokenFile[]): string[] {
  const counts: Record<TokenKind, number> = { image: 0, file: 0 };
  return files.map((file) => {
    const kind = kindOf(file);
    counts[kind] += 1;
    return `[${kind}${counts[kind]}]`;
  });
}

/** `[Image 1 · 54 KB]` shown as `Image 1 · 54 KB`. */
export function tokenLabel(token: string): string {
  return token.replace(/^\[|\]$/g, "");
}

/**
 * Tokens in `text` that refer to one of `files`.
 *
 * A token for a number no attachment has, one inside a code span or fenced
 * block, and one glued to a preceding word are ordinary text.
 */
export function findTokens(text: string, files: TokenFile[]): TokenMatch[] {
  if (!files.length) return [];
  const named = new Map<string, number>();
  if (text.includes("; ref=")) {
    const byId = new Map<string, number>();
    files.forEach((file, index) => {
      if (!file.id) return;
      const kind = kindOf(file);
      byId.set(`${kind}:${file.id}`, index);
    });
    for (const [raw, kind, , id] of text.matchAll(NAMED_REFERENCE)) {
      const type = kind.toLowerCase();
      const prefix = `${type}_`;
      const index =
        byId.get(`${type}:${id}`) ??
        (id.startsWith(prefix) ? byId.get(`${type}:${id.slice(prefix.length)}`) : undefined);
      if (index !== undefined) named.set(raw, index);
    }
  }
  const drafts = attachmentDraftTokens(files);
  drafts.forEach((token, index) => named.set(token, index));
  return findTokenMatches(text, attachmentTokens(files), legacyAttachmentTokens(files), named);
}

/** Occurrences of the exact `tokens` (or same-index `aliases`) in `text`; `index` is the token's place in `tokens`. */
export function findTokenMatches(
  text: string,
  tokens: readonly string[],
  aliases: readonly string[] = [],
  named?: ReadonlyMap<string, number>,
): TokenMatch[] {
  if (!tokens.length || !text.includes("[")) return [];
  const indexByToken = new Map(aliases.map((token, index) => [token, index]));
  tokens.forEach((token, index) => indexByToken.set(token, index));
  const code = codeRanges(text);
  const matches: TokenMatch[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const index = named?.get(match[0]) ?? indexByToken.get(match[0]);
    if (index === undefined) continue;
    const start = match.index;
    if (
      start > 0 &&
      WORD_CHAR.test(text[start - 1]) &&
      !named?.has(match[0]) &&
      !match[0].includes(NBSP)
    )
      continue;
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

/** Named references without an owning attachment can still show their filename in the draft. */
export function splitNamedAttachmentReferences(text: string) {
  const parts: ({ text: string } | { token: string; name: string })[] = [];
  const code = codeRanges(text);
  let start = 0;
  for (const match of text.matchAll(NAMED_REFERENCE)) {
    if (code.some(([from, to]) => match.index >= from && match.index < to)) continue;
    if (start < match.index) parts.push({ text: text.slice(start, match.index) });
    parts.push({ token: match[0], name: match[2] });
    start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
}

function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (["InlineCode", "FencedCode", "CodeBlock"].includes(node.name)) {
        ranges.push([node.from, node.to]);
        return false;
      }
    },
  });
  return ranges;
}

/** The text with every token that refers to one of `files` taken out. */
export function stripAttachmentTokens(text: string, files: TokenFile[]): string {
  return rewriteTokens(text, files, () => "");
}

/** The text cut into plain runs and the tokens that name an attachment. */
export function splitAttachmentTokens(text: string, files: Attachment[]): TextSegment[] {
  const segments: TextSegment[] = [];
  const matches = findTokens(text, files);
  const display = matches.length ? attachmentDraftTokens(files) : [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) segments.push({ text: text.slice(at, match.start) });
    segments.push({
      token: match.token,
      label: tokenLabel(match.token),
      attachment: files[match.index],
      ...(match.token === display[match.index] && files[match.index].name
        ? { fullName: true }
        : {}),
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
export function tokensForIncoming(existing: TokenFile[], incoming: TokenFile[]): string {
  return attachmentDraftTokens([...existing, ...incoming])
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
  files: TokenFile[],
  removedIndex: number,
): string {
  if (removedIndex < 0 || removedIndex >= files.length) return text;
  const retained = files.filter((_, i) => i !== removedIndex);
  const after = attachmentTokens(retained);
  const priorDrafts = attachmentDraftTokens(files);
  const nextDrafts = attachmentDraftTokens(retained);
  return rewriteTokens(text, files, (match) => {
    if (match.index === removedIndex) return "";
    const index = match.index > removedIndex ? match.index - 1 : match.index;
    return match.token === priorDrafts[match.index] ? nextDrafts[index] : after[index];
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
  files: TokenFile[],
): number[] {
  if (before === after) return [];
  const previous = findTokens(before, files);
  if (previous.length === 0) return [];
  const retained = new Set(findTokens(after, files).map((match) => match.index));
  const dropped = new Set<number>();
  for (const match of previous) {
    if (!after.includes(match.token) && !retained.has(match.index)) dropped.add(match.index);
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
  files: TokenFile[],
  /** Further tokens deleted whole, such as citation `[quote1]` tokens. */
  extra: readonly string[] = [],
  /** Recognized non-bracket references, already parsed by their owning feature. */
  ranges: readonly { start: number; end: number }[] = [],
): { text: string; caret: number } | null {
  const hit = [...findTokens(text, files), ...findTokenMatches(text, extra), ...ranges].find(
    (match) => (direction === "back" ? match.end === caret : match.start === caret),
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
  files: TokenFile[],
  replace: (match: TokenMatch) => string,
): string {
  return rewriteTokenMatches(text, findTokens(text, files), replace);
}

/** `rewriteTokens` over matches found by the caller, in text order. */
export function rewriteTokenMatches(
  text: string,
  matches: readonly TokenMatch[],
  replace: (match: TokenMatch) => string,
): string {
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
