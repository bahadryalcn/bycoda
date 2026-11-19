/**
 * Text truncation that never splits a user-perceived character.
 *
 * `String.prototype.slice` counts UTF-16 code units, so `"🚀".slice(0, 1)` is a lone surrogate.
 * Such a string fails JSON parsing on the Rust side (serde rejects unpaired surrogates), which
 * made tray updates and notifications fail whenever a title ended in an emoji. Flags, skin
 * tones and combining marks are several code points as well, so code points are not enough
 * either; grapheme clusters are the unit people see.
 */

// The app targets ES2020 lib typings; Intl.Segmenter (ES2022) exists at runtime in every
// supported webview and in Node 16+, so it is feature-detected here like in publishingFormats.
type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
const segmenter: GraphemeSegmenter | undefined = (() => {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter;
    }
  ).Segmenter;
  return typeof Segmenter === "function"
    ? new Segmenter(undefined, { granularity: "grapheme" })
    : undefined;
})();

/** User-perceived characters of `text` (grapheme clusters; code points as a fallback). */
export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (part) => part.segment);
  return Array.from(text);
}

/** Number of user-perceived characters in `text`. */
export function graphemeLength(text: string): number {
  return graphemes(text).length;
}

/**
 * Keep at most `max` graphemes of `text`. When the text is longer, the result ends with
 * `suffix` and the suffix counts toward `max`, so the result is never longer than `max`
 * graphemes.
 */
export function truncateGraphemes(text: string, max: number, suffix = "…"): string {
  if (!(max > 0)) return "";
  const parts = graphemes(text);
  if (parts.length <= max) return text;
  const keep = Math.max(0, max - graphemeLength(suffix));
  return parts.slice(0, keep).join("") + suffix;
}

/**
 * For callers with a UTF-16 unit budget (native buffers, protocol limits): slice by code
 * units but never end on a high surrogate, so the result is always valid UTF-16.
 */
export function truncateCodeUnits(text: string, maxUnits: number): string {
  if (!(maxUnits > 0)) return "";
  if (text.length <= maxUnits) return text;
  const result = text.slice(0, maxUnits);
  return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
}
