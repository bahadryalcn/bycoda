/** Event annotations are recognizer metadata, never user instructions. Keep
 * lexical speech, including single-word replies, without a phrase blacklist. */
export function speechTranscript(text: string): string {
  const event =
    "(?:cough(?:ing)?|clears? throat|throat clearing|breath(?:ing)?|sigh(?:ing)?|keyboard|typing|noise|silence|music|öksürük|öksürme|boğaz temizleme|nefes|sessizlik)";
  const spoken = text
    .replace(
      new RegExp(`\\[\\s*${event}\\s*\\]|\\(\\s*${event}\\s*\\)|<\\s*${event}\\s*>`, "giu"),
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(spoken) ? spoken : "";
}
