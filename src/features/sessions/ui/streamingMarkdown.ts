import remend from "remend";
import { parseMarkdownIntoBlocks } from "streamdown";

export function isFenceBlock(content: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(content);
}

// Inputs Streamdown always parses whole: footnotes, reference definitions and CR line ends.
const FOOTNOTE = /\[\^[\w-]{1,200}\]/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
const BLANK_LINE_END = "\n\n";
const STREAMS_MAX = 32;

/**
 * The last parse of each stream. Streamdown's own incremental cache holds one input
 * for the whole app, so two replies streaming at once (or any other message parsed
 * in between) made every frame lex the full reply again.
 */
const streams = new Map<string, { input: string; blocks: string[] }>();

/** Index after the last settled block: one ending in a blank line, before the final two. */
function settledBlocks(blocks: readonly string[]): number {
  for (let index = blocks.length - 3; index >= 0; index -= 1)
    if (blocks[index].endsWith(BLANK_LINE_END)) return index + 1;
  return 0;
}

/**
 * The same blocks as `parseMarkdownIntoBlocks(text)`. When `stream` names a growing
 * text, blocks that ended in a blank line are kept and only the rest is lexed, the
 * rule Streamdown applies to its own single cached input.
 */
export function markdownBlocks(text: string, stream?: string): string[] {
  const previous = stream === undefined ? undefined : streams.get(stream);
  let blocks: string[] | undefined;
  if (
    previous &&
    text.length > previous.input.length &&
    text.startsWith(previous.input) &&
    !text.includes("\r") &&
    !FOOTNOTE.test(text) &&
    !REFERENCE_DEFINITION.test(text)
  ) {
    const settled = settledBlocks(previous.blocks);
    if (settled > 0) {
      let offset = 0;
      for (let index = 0; index < settled; index += 1) offset += previous.blocks[index].length;
      blocks = previous.blocks
        .slice(0, settled)
        .concat(parseMarkdownIntoBlocks(text.slice(offset)));
    }
  }
  blocks ??= [...parseMarkdownIntoBlocks(text)];
  if (stream !== undefined) {
    streams.delete(stream);
    streams.set(stream, { input: text, blocks });
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
