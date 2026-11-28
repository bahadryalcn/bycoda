const RTL_LETTER =
  /(?=\p{L})[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const STRONG_LETTER = /\p{L}/u;

/** Text a reader sees: fences, inline code, heading/list/quote markers, emphasis and link targets removed. */
function visibleText(markdown: string) {
  return markdown
    .replace(/(```|~~~)[\s\S]*?\1/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*{1,3}|_{1,3})/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[\s>*\-+\d.]+/gm, "");
}

/**
 * Unicode first-strong rule (what `dir="auto"` does): the first strong letter
 * of the visible Markdown text decides. Text without a strong letter is LTR.
 */
export function detectMarkdownDirection(markdown: string): "ltr" | "rtl" {
  for (const char of visibleText(markdown)) {
    if (RTL_LETTER.test(char)) return "rtl";
    if (STRONG_LETTER.test(char)) return "ltr";
  }
  return "ltr";
}
