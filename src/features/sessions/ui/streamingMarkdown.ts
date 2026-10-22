import remend from "remend";
import { parseMarkdownIntoBlocks } from "streamdown";

export function isFenceBlock(content: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(content);
}

/** Streamdown caches completed blocks; only the unfinished tail needs repair. */
export function parseStreamingMarkdown(text: string): string[] {
  const blocks = parseMarkdownIntoBlocks(text);
  const tail = blocks[blocks.length - 1];
  if (!tail || isFenceBlock(tail)) return blocks;
  const repaired = remend(tail);
  if (repaired === tail) return blocks;
  // Never mutate Streamdown's cached array.
  return [...blocks.slice(0, -1), repaired];
}
