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

// Whether each block matches a query, remembered per block object. While a
// reply streams only its block is replaced each frame, so every other block is a
// lookup instead of a scan of its text. A few recent queries stay cached because
// several panes can search at once.
const MAX_CACHED_QUERIES = 8;
const matchCache = new Map<string, WeakMap<Block, boolean>>();

function matchesFor(needle: string): WeakMap<Block, boolean> {
  let results = matchCache.get(needle);
  if (results) {
    matchCache.delete(needle);
  } else {
    results = new WeakMap();
    if (matchCache.size >= MAX_CACHED_QUERIES) {
      const oldest = matchCache.keys().next().value;
      if (oldest !== undefined) matchCache.delete(oldest);
    }
  }
  matchCache.set(needle, results);
  return results;
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
  const results = matchesFor(needle);
  const found: string[] = [];
  for (const block of blocks) {
    if (
      block.role !== "user" &&
      block.role !== "assistant" &&
      block.role !== "tool" &&
      block.role !== "tasks" &&
      block.role !== "plan" &&
      block.role !== "image"
    )
      continue;
    let matched = results.get(block);
    if (matched === undefined) {
      matched = blockMatches(foldedBlockText(block), needle, words);
      results.set(block, matched);
    }
    if (matched) found.push(block.id);
  }
  return found;
}

function blockMatches(text: string, phrase: string, words: string[]): boolean {
  return text.includes(phrase) || words.every((word) => text.includes(word));
}
