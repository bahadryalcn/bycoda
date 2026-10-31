// oxlint-disable no-control-regex -- terminal control bytes are the input being removed.
// Include replacement-character introducers from older, lossy terminal captures.
const TERMINAL_CONTROL = /(?:[\u001b\ufffd]\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c|$)|(?:[\u001b\ufffd][PX^_]|[\u0090\u0098\u009e\u009f])[^\u001b\u009c]*(?:\u001b\\|\u009c|$)|(?:[\u001b\ufffd]\[|\u009b)[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]|[\u0000-\u001f\u007f-\u009f]/g;

/** Display-only plain text and UTF-16 match offsets; never change stored search targets. */
export function terminalText(text: string, positions: readonly number[] = []): {
  text: string;
  positions: number[];
} {
  const marked = new Set(positions);
  const mapped: number[] = [];
  let clean = "";
  let cursor = 0;
  const append = (end: number) => {
    for (; cursor < end; cursor++) {
      if (marked.has(cursor)) mapped.push(clean.length);
      clean += text[cursor];
    }
  };
  for (const match of text.matchAll(TERMINAL_CONTROL)) {
    append(match.index);
    // Keep word boundaries when flattening whitespace into single-line excerpts.
    if (/^[\t\r\n]$/.test(match[0])) {
      if (marked.has(cursor)) mapped.push(clean.length);
      clean += " ";
    }
    cursor = match.index + match[0].length;
  }
  append(text.length);
  return { text: clean, positions: mapped };
}
