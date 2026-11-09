import { chatCitationToken } from "./chatCitation";
import { findTokenMatches, rewriteTokenMatches, type TokenMatch } from "./attachmentTokens";

/**
 * Inline `[quote1]` references to a draft's or message's citations.
 *
 * The citation list stays the authority: a token is plain text that lets the
 * user place a quote inside a sentence, and deleting one keeps its citation.
 */
export function chatCitationTokens(count: number): string[] {
  return Array.from({ length: count }, (_, index) => chatCitationToken(index));
}

/** Tokens in `text` that name one of `count` citations, outside code. */
export function findCitationTokens(text: string, count: number): TokenMatch[] {
  return findTokenMatches(text, chatCitationTokens(count));
}

/** The text cut into plain runs and the tokens that name a citation. */
export function splitCitationTokens(
  text: string,
  count: number,
): ({ text: string } | { token: string; index: number })[] {
  const parts: ({ text: string } | { token: string; index: number })[] = [];
  let at = 0;
  for (const match of findCitationTokens(text, count)) {
    if (match.start > at) parts.push({ text: text.slice(at, match.start) });
    parts.push({ token: match.token, index: match.index });
    at = match.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Removes the citation token at `removedIndex` and renumbers the rest to stay gapless. */
export function removeCitationFromText(text: string, count: number, removedIndex: number): string {
  if (removedIndex < 0 || removedIndex >= count) return text;
  const after = chatCitationTokens(count - 1);
  return rewriteTokenMatches(text, findCitationTokens(text, count), (match) =>
    match.index === removedIndex
      ? ""
      : after[match.index > removedIndex ? match.index - 1 : match.index],
  );
}
