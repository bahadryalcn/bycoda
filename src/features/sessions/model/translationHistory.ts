export type TranslationHistory = { original: string; translated: string };

export function selectedTextOffset(value: string, text: string, occurrence = 0): number {
  if (!text || occurrence < 0) return -1;
  let index = value.indexOf(text);
  for (let count = 0; count < occurrence && index >= 0; count += 1)
    index = value.indexOf(text, index + text.length);
  return index;
}

export function translatedSelection(
  value: string,
  start: number,
  end: number,
  translation: string,
): TranslationHistory {
  return { original: value, translated: value.slice(0, start) + translation + value.slice(end) };
}

/** Only unchanged approved versions participate; ordinary edits invalidate history. */
export function translationHistoryKey(
  history: TranslationHistory | null,
  value: string,
  key: string,
): string | undefined {
  if (!history || (value !== history.original && value !== history.translated)) return undefined;
  return key === "ArrowUp"
    ? history.original
    : key === "ArrowDown"
      ? history.translated
      : undefined;
}
