// oxlint-disable no-control-regex -- terminal control bytes are the input being parsed.

/** One of the 16 standard terminal colors: 0-7 normal, 8-15 bright. */
export type AnsiColorIndex = number;

export interface AnsiStyle {
  fg?: AnsiColorIndex;
  bg?: AnsiColorIndex;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

// CSI (SGR and cursor/erase sequences), OSC, DCS/SOS/PM/APC strings, two-byte
// escapes, and stray C0/C1 controls. U+FFFD covers introducers from lossy captures.
const CONTROL =
  /(?:[\u001b�]\[|\u009b)([0-?]*)[ -/]*([@-~])|(?:[\u001b�]\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c|$)|(?:[\u001b�][PX^_]|[\u0090\u0098\u009e\u009f])[^\u001b\u009c]*(?:\u001b\\|\u009c|$)|\u001b[ -/]*[0-~]|\r\n?|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

const HAS_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]|�[[\]PX^_]/;

/** Applies one SGR parameter list to the running style. */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((code) => Number(code) || 0);
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) next.bold = next.dim = undefined;
    else if (code === 23) next.italic = undefined;
    else if (code === 24) next.underline = undefined;
    else if (code === 29) next.strike = undefined;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code === 39) next.fg = undefined;
    else if (code >= 40 && code <= 47) next.bg = code - 40;
    else if (code === 49) next.bg = undefined;
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
    else if (code === 38 || code === 48) {
      // shortcut: 256-color indexes above 15 and truecolor fall back to the default
      // color; map them to the nearest theme color if output needs them.
      const mode = codes[i + 1];
      let color: number | undefined;
      if (mode === 5) {
        const index = codes[i + 2];
        color = index !== undefined && index < 16 ? index : undefined;
        i += 2;
      } else if (mode === 2) {
        i += 4;
      } else {
        i += 1;
      }
      if (code === 38) next.fg = color;
      else next.bg = color;
    }
  }
  return next;
}

/**
 * Splits terminal output into styled text runs. Color and weight escapes become
 * styles; cursor, title and other control sequences are dropped; a carriage
 * return starts a new line so progress updates stay readable.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  if (!HAS_CONTROL.test(text)) return text ? [{ text, style: {} }] : [];
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let cursor = 0;
  const push = (chunk: string) => {
    if (!chunk) return;
    const last = segments[segments.length - 1];
    if (last && last.style === style) last.text += chunk;
    else segments.push({ text: chunk, style });
  };
  for (const match of text.matchAll(CONTROL)) {
    push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[0][0] === "\r") push("\n");
    else if (match[2] === "m") style = applySgr(style, match[1]);
  }
  push(text.slice(cursor));
  return segments;
}

/** Plain text of terminal output, for copying and measuring. */
export function stripAnsi(text: string): string {
  if (!HAS_CONTROL.test(text)) return text;
  return parseAnsi(text)
    .map((segment) => segment.text)
    .join("");
}
