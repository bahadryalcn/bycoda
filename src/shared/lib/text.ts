/** ASCII whitespace accepted by composer token parsers. */
export function isSpace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}
