import { foldSearchText } from "../../../shared/lib/searchFold";
import type { Block } from "./session";

export function transcriptBlockText(block: Block): string {
  const parts: string[] = [];
  if (block.text.trim()) parts.push(block.text);
  if (block.tool?.title) parts.push(block.tool.title);
  if (block.image?.name) parts.push(block.image.name);
  if (block.image?.alt) parts.push(block.image.alt);
  if (block.tool?.detail) parts.push(block.tool.detail);
  if (block.tool?.preview?.query) parts.push(block.tool.preview.query);
  if (block.tool?.preview?.path) parts.push(block.tool.preview.path);
  if (block.tool?.preview?.output) parts.push(block.tool.preview.output);
  if (block.tool?.preview?.title) parts.push(block.tool.preview.title);
  return parts.join("\n");
}

// Blocks are replaced, never mutated, so the folded text can be cached per
// block object; only changed blocks are re-folded per keystroke/stream frame.
const foldedCache = new WeakMap<Block, string>();

function foldedBlockText(block: Block): string {
  let folded = foldedCache.get(block);
  if (folded === undefined) {
    folded = foldSearchText(transcriptBlockText(block));
    foldedCache.set(block, folded);
  }
  return folded;
}

/**
 * Blocks containing the query, case- and Turkish-insensitively: the whole
 * phrase, or every word of it anywhere in the block (what the cross-session
 * search matches, so a result opened from there is found here too).
 */
export function findTranscriptBlocks(blocks: Block[], query: string): string[] {
  const needle = foldSearchText(query.trim());
  if (!needle) return [];
  const words = needle.split(/\s+/);
  return blocks
    .filter(
      (block) =>
        (block.role === "user" ||
          block.role === "assistant" ||
          block.role === "tool" ||
          block.role === "tasks" ||
          block.role === "plan" ||
          block.role === "image") &&
        blockMatches(foldedBlockText(block), needle, words),
    )
    .map((block) => block.id);
}

function blockMatches(text: string, phrase: string, words: string[]): boolean {
  return text.includes(phrase) || words.every((word) => text.includes(word));
}
