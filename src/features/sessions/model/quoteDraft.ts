export const ADD_TO_CHAT_EVENT = "bycoda:add-to-chat";

export type AddToChatMode = "quote" | "plain";

export type AddToChatRequest = {
  text: string;
  mode: AddToChatMode;
};

export type QuoteRequest = {
  id: number;
  text: string;
  mode?: AddToChatMode;
};

/**
 * Normalizes line endings and drops only leading/trailing blank lines. Leading
 * indentation of the first content line is meaningful for code, terminal output
 * and YAML, so the text is never `trim()`med; `trim()` only decides emptiness.
 */
export function normalizeSelectedText(text: string): string {
  if (!text.trim()) return "";
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "");
}

export function requestAddToChat(text: string, mode: AddToChatMode = "quote") {
  if (typeof window === "undefined") return;
  const value = normalizeSelectedText(text);
  if (!value) return;
  window.dispatchEvent(
    new CustomEvent<AddToChatRequest>(ADD_TO_CHAT_EVENT, {
      detail: { text: value, mode },
    }),
  );
}

/** Initial composer text for an add-to-chat request that opens a new session. */
export function composerSeedForAddToChat(text: string, mode: AddToChatMode = "quote"): string {
  return mode === "plain" ? appendComposerInsert("", text) : appendSelectionQuote("", text);
}

export type QuoteConsumption = {
  draft: string;
  consumedId: number | null;
  changed: boolean;
};

export function isMarkdownBlockquotePosition(text: string, position: number): boolean {
  const index = Math.max(0, Math.min(position, text.length));
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return /^ {0,3}>/.test(text.slice(lineStart, index));
}

export function appendSelectionQuote(draft: string, text: string): string {
  const selected = normalizeSelectedText(text);
  if (!selected) return draft;

  const quote = selected
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return joinComposerInsert(draft, quote);
}

export function appendComposerInsert(draft: string, text: string): string {
  const selected = normalizeSelectedText(text);
  if (!selected) return draft;
  return joinComposerInsert(draft, selected);
}

export function consumeQuoteRequest(
  draft: string,
  consumedId: number | null,
  request: QuoteRequest | undefined,
): QuoteConsumption {
  if (!request || request.id === consumedId) {
    return { draft, consumedId, changed: false };
  }

  const next =
    request.mode === "plain"
      ? appendComposerInsert(draft, request.text)
      : appendSelectionQuote(draft, request.text);
  return {
    draft: next,
    consumedId: request.id,
    changed: next !== draft,
  };
}

export function acknowledgeQuoteRequest(
  current: QuoteRequest | undefined,
  handledId: number,
): QuoteRequest | undefined {
  return current?.id === handledId ? undefined : current;
}

function joinComposerInsert(draft: string, block: string): string {
  const separator =
    draft.length === 0 ? "" : draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  return `${draft}${separator}${block}\n\n`;
}
