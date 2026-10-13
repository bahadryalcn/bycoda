import remend from "remend";
import { parseMarkdownIntoBlocks } from "streamdown";

export function isFenceBlock(content: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(content);
}

/** Split before repairing incomplete prose. Literal fences need no repair. */
export function parseStreamingMarkdown(text: string): string[] {
  return parseMarkdownIntoBlocks(text).map((block) => isFenceBlock(block) ? block : remend(block));
}
