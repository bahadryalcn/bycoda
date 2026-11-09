import remend from "remend";
import { parseMarkdownIntoBlocks } from "streamdown";

export function isFenceBlock(content: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(content);
}

// Inputs Streamdown always parses whole: footnotes, reference definitions and CR line ends.
const FOOTNOTE = /\[\^[\w-]{1,200}\]/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
const BLANK_LINE_END = "\n\n";
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const STREAMS_MAX = 32;
// A footnote label is at most 203 characters, so a match crossing the old text ends in this window.
const FOOTNOTE_WINDOW = 210;

/**
 * The last parse of one stream. `plain` means the input has no footnote, reference
 * definition or CR, so the incremental path may extend it.
 */
type Stream = { input: string; blocks: string[]; plain: boolean };

/**
 * The last parse of each stream. Streamdown's own incremental cache holds one input
 * for the whole app, so two replies streaming at once (or any other message parsed
 * in between) made every frame lex the full reply again.
 */
const streams = new Map<string, Stream>();

function isPlain(text: string): boolean {
  return !text.includes("\r") && !FOOTNOTE.test(text) && !REFERENCE_DEFINITION.test(text);
}

/** Whether `previous.input + appended` is still plain; scans only what a match can cross. */
function staysPlain(previous: Stream, appended: string): boolean {
  if (appended.includes("\r")) return false;
  if (FOOTNOTE.test(previous.input.slice(-FOOTNOTE_WINDOW) + appended)) return false;
  // A reference label cannot contain "]", so a match crossing the old text starts after the
  // "]" before the last one (the last "]" may be the label's end with its ":" appended).
  const close = previous.input.lastIndexOf("]");
  const from = close <= 0 ? 0 : previous.input.lastIndexOf("]", close - 1) + 1;
  if (previous.input.indexOf("[", from) === -1 && !appended.includes("[")) return true;
  return !REFERENCE_DEFINITION.test(previous.input.slice(from) + appended);
}

/** The fence run (`` ``` `` or `~~~`) that opens `block`, if it opens one. */
function fenceRun(block: string): string | undefined {
  return FENCE_OPEN.exec(block)?.[1];
}

/** Index after the last non-whitespace character. */
function contentEnd(text: string): number {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  return end;
}

/**
 * Whether a fence block has its closing line. The block is one fence token followed only by
 * whitespace, so its last content line is the closer when the fence is closed. The opening
 * line never closes its own fence.
 */
function closesFence(block: string, run: string): boolean {
  const end = contentEnd(block);
  const start = block.lastIndexOf("\n", end - 1) + 1;
  const opener = block.indexOf("\n");
  const closer = new RegExp(`^ {0,3}${run[0]}{${run.length}}[~\`]*$`);
  return opener !== -1 && start > opener && closer.test(block.slice(start, end));
}

/** Whether text contains a line that could close a fence opened by `run`. */
function startsClosingLine(text: string, run: string): boolean {
  return new RegExp(`(?:^|\\n) {0,3}${run[0]}{${run.length}}`).test(text);
}

/**
 * The blocks of `text`, which extends `previous.input`, built from `previous.blocks`
 * without lexing the whole text. Undefined when the blocks cannot be kept safely.
 */
function extendBlocks(previous: Stream, text: string): string[] | undefined {
  const { blocks } = previous;
  const last = blocks.length - 1;
  const appended = text.slice(previous.input.length);
  const run = last >= 0 ? fenceRun(blocks[last]) : undefined;
  // An open fence runs to the end of the text and holds no markdown, so appended text
  // extends its block. The lexer decides every earlier block before this fence opener line,
  // which is already in the previous input.
  if (run !== undefined && !closesFence(blocks[last], run)) {
    const openLine = previous.input.slice(previous.input.lastIndexOf("\n") + 1);
    if (!startsClosingLine(openLine + appended, run))
      return [...blocks.slice(0, last), blocks[last] + appended];
  }
  // Settled blocks: a closed fence (followed by a block in the old text), or a block that
  // ends in a blank line with two blocks after it.
  let settled = 0;
  for (let index = last - 1; index >= 0; index -= 1) {
    const blockRun = fenceRun(blocks[index]);
    const isSettled =
      blockRun !== undefined
        ? closesFence(blocks[index], blockRun)
        : index <= last - 2 && blocks[index].endsWith(BLANK_LINE_END);
    if (isSettled) {
      settled = index + 1;
      break;
    }
  }
  if (settled === 0) return undefined;
  let offset = 0;
  for (let index = 0; index < settled; index += 1) offset += blocks[index].length;
  return blocks.slice(0, settled).concat(parseMarkdownIntoBlocks(text.slice(offset)));
}

/**
 * The same blocks as `parseMarkdownIntoBlocks(text)`. When `stream` names a growing
 * text, the blocks that are provably unchanged are kept and only the rest is lexed.
 */
export function markdownBlocks(text: string, stream?: string): string[] {
  const previous = stream === undefined ? undefined : streams.get(stream);
  let plain = false;
  let blocks: string[] | undefined;
  if (
    previous?.plain &&
    text.length > previous.input.length &&
    text.startsWith(previous.input) &&
    staysPlain(previous, text.slice(previous.input.length))
  ) {
    plain = true;
    blocks = extendBlocks(previous, text);
  }
  if (!blocks) {
    plain = isPlain(text);
    blocks = [...parseMarkdownIntoBlocks(text)];
  }
  if (stream !== undefined) {
    streams.delete(stream);
    streams.set(stream, { input: text, blocks, plain });
    if (streams.size > STREAMS_MAX) streams.delete(streams.keys().next().value!);
  }
  return blocks;
}

/** Streamdown caches completed blocks; only the unfinished tail needs repair. */
export function parseStreamingMarkdown(text: string, stream?: string): string[] {
  const blocks = markdownBlocks(text, stream);
  const tail = blocks[blocks.length - 1];
  if (!tail || isFenceBlock(tail)) return blocks;
  const repaired = remend(tail);
  if (repaired === tail) return blocks;
  // Never mutate a cached block list.
  return [...blocks.slice(0, -1), repaired];
}
