/** Mark fenced code, inline code, and blockquote characters ignored by mention parsing. */
export function ignoredMentionMarkdown(text: string): Uint8Array {
  const ignored = new Uint8Array(text.length);
  let fence: { marker: string; length: number } | undefined;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0];
    const start = match.index;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (fence) {
      ignored.fill(1, start, start + line.length);
      if (
        marker &&
        marker[1]![0] === fence.marker &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = undefined;
    } else if (marker) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      ignored.fill(1, start, start + line.length);
    } else if (/^ {0,3}>/.test(line)) {
      ignored.fill(1, start, start + line.length);
    }
  }
  const ticks = [...text.matchAll(/`+/g)];
  for (let i = 0; i < ticks.length; i++) {
    const open = ticks[i]!;
    if (ignored[open.index]) continue;
    const close = ticks.findIndex(
      (tick, index) => index > i && !ignored[tick.index] && tick[0].length === open[0].length,
    );
    if (close < 0) continue;
    ignored.fill(1, open.index, ticks[close]!.index + ticks[close]![0].length);
    i = close;
  }
  return ignored;
}
