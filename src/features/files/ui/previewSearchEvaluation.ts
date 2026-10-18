export type PreviewSearchOptions = { caseSensitive: boolean; wholeWord: boolean; regexp: boolean };
export type PreviewTextMatch = { run: number; from: number; to: number };
export type PreviewTextResult = {
  matches: PreviewTextMatch[];
  capped: boolean;
  invalid: boolean;
  timedOut?: boolean;
};

/** Arbitrary regex evaluation is called only inside the terminable search worker. */
export function evaluatePreviewSearch(
  texts: string[],
  query: string,
  options: PreviewSearchOptions,
): PreviewTextResult {
  const matches: PreviewTextMatch[] = [];
  if (!query) return { matches, capped: false, invalid: false };
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      options.regexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      options.caseSensitive ? "gu" : "giu",
    );
  } catch {
    return { matches, capped: false, invalid: true };
  }
  const word = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);
  for (let run = 0; run < texts.length; run++) {
    const text = texts[run]!;
    for (const match of text.matchAll(pattern)) {
      if (!match[0]) continue;
      const from = match.index,
        to = from + match[0].length;
      if (options.wholeWord && (word(text[from - 1]) || word(text[to]))) continue;
      if (matches.length >= 999) return { matches, capped: true, invalid: false };
      matches.push({ run, from, to });
    }
  }
  return { matches, capped: false, invalid: false };
}
