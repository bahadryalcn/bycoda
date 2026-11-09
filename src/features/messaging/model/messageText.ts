export type MessageTextPart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// Sentence punctuation that usually follows a link rather than belonging to it.
const TRAILING = /[.,;:!?)\]}]+$/;

function trimTrailing(url: string): string {
  let result = url;
  for (;;) {
    const match = TRAILING.exec(result);
    if (!match) return result;
    const tail = match[0];
    // Keep a closing parenthesis that balances one inside the link (Wikipedia-style URLs).
    if (tail.startsWith(")")) {
      const opens = (result.match(/\(/g) ?? []).length;
      const closes = (result.match(/\)/g) ?? []).length;
      if (opens >= closes) return result;
    }
    result = result.slice(0, -1);
  }
}

/** Splits plain message text into text and http(s) link parts. Nothing else is interpreted. */
export function splitMessageText(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let index = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimTrailing(match[0]);
    if (!url.includes("://") || url.endsWith("://")) continue;
    if (start > index) parts.push({ kind: "text", text: text.slice(index, start) });
    parts.push({ kind: "link", text: url, url });
    index = start + url.length;
  }
  if (index < text.length) parts.push({ kind: "text", text: text.slice(index) });
  return parts;
}
