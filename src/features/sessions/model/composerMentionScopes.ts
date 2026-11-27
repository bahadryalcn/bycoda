import { NOTE_MENTION_PREFIX, NOTES_MENTION_SCOPE } from "../../notes";
import type { RankedFile } from "../../files";
import { CREWS_MENTION_SCOPE } from "./crewMentions";
import { providerForAlias } from "../../inbox/public/workItemMentions";
import { ignoredMentionMarkdown } from "../../../shared/lib/text/ignoredMentionMarkdown";
import { isMarkdownBlockquotePosition } from "./quoteDraft";

export type ComposerMentionScope = typeof CREWS_MENTION_SCOPE | typeof NOTES_MENTION_SCOPE;
const SCOPE_HINT_PATH = "composer-mention-scope/";

export function composerMentionScope(query: string): ComposerMentionScope | undefined {
  const normalized = query.toLowerCase();
  if (normalized.startsWith(CREWS_MENTION_SCOPE)) return CREWS_MENTION_SCOPE;
  if (normalized.startsWith(NOTES_MENTION_SCOPE)) return NOTES_MENTION_SCOPE;
}

export function composerMentionScopeHint(
  scope: ComposerMentionScope,
  query: string,
  available: boolean,
): RankedFile[] {
  if (!available || !scope.startsWith(query.toLowerCase())) return [];
  return [
    {
      name: scope,
      path: `${SCOPE_HINT_PATH}${scope}`,
      relative: scope,
      score: 0,
      positions: [],
    },
  ];
}

export function composerMentionScopeHintOf(file: {
  path: string;
}): ComposerMentionScope | undefined {
  return file.path.startsWith(SCOPE_HINT_PATH)
    ? composerMentionScope(file.path.slice(SCOPE_HINT_PATH.length))
    : undefined;
}

export function scopedNoteMentionLabel(label: string): string {
  return `${NOTES_MENTION_SCOPE}${label.slice(NOTE_MENTION_PREFIX.length)}`;
}

export type ScopedMentionKind = "crew" | "note" | "work-item";

/** Visual ranges also work for saved messages with no project catalog. */
export function scopedMentionRanges(
  text: string,
  { markdownTree = false } = {},
): { start: number; end: number; kind: ScopedMentionKind }[] {
  if (!text.includes("@")) return [];
  const ranges: ReturnType<typeof scopedMentionRanges> = [];
  const tokens =
    /(^|[\s([{])(@(?:(?:crews:|notes:|note\/)[a-z0-9_-]+(?=[.,;:!?)\]}"']*(?:\s|$))|([a-z]+):[a-z0-9](?:[a-z0-9_./#!-]*[a-z0-9])?))/gi;
  let ignored: Uint8Array | undefined;
  for (const match of text.matchAll(tokens)) {
    const [, boundary, token, alias] = match;
    if (alias && !providerForAlias(alias)) continue;
    const start = match.index + boundary.length;
    if (!markdownTree) ignored ??= ignoredMentionMarkdown(text);
    if (ignored?.[start] || (markdownTree && isMarkdownBlockquotePosition(text, start))) continue;
    const kind = alias
      ? "work-item"
      : token.slice(1).toLowerCase().startsWith(CREWS_MENTION_SCOPE)
        ? "crew"
        : "note";
    ranges.push({ start, end: start + token.length, kind });
  }
  return ranges;
}

export function scopedMentionParts(text: string): { text: string; kind?: ScopedMentionKind }[] {
  const parts: ReturnType<typeof scopedMentionParts> = [];
  let offset = 0;
  for (const { start, end, kind } of scopedMentionRanges(text)) {
    if (start > offset) parts.push({ text: text.slice(offset, start) });
    parts.push({ text: text.slice(start, end), kind });
    offset = end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

/** A completed mention and its adjacent separator are one deletion. */
export function deleteScopedMentionAtCaret(
  text: string,
  caret: number,
  direction: "back" | "forward",
  searching = false,
): { text: string; caret: number; end: number } | null {
  if (searching && direction === "back" && text[caret - 1] !== " ") return null;
  const hit = scopedMentionRanges(text).find(({ start, end }) =>
    direction === "back"
      ? end === caret || (end + 1 === caret && text[end] === " ")
      : start === caret,
  );
  if (!hit) return null;
  const removeSpace =
    text[hit.end] === " " &&
    (caret > hit.end || hit.start === 0 || /\s/.test(text[hit.start - 1] ?? ""));
  const end = hit.end + Number(removeSpace);
  return { text: text.slice(0, hit.start) + text.slice(end), caret: hit.start, end };
}
