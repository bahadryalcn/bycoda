/** Callers retain their empty/undefined policy; this only trims and caps text. */
export function trimAndCapText(value: string, limit = 8_000, suffix = "\n…"): string {
  const text = value.trim();
  return text.length <= limit ? text : text.slice(0, limit) + suffix;
}
