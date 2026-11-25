import { isWebSearchName, type SearchSource } from "../../../shared/model/searchSources";
import type { Block, ToolPreview } from "./session";

export * from "../../../shared/model/searchSources";

/** The turn's sources in the order its searches ran, one entry per URL: citation `[n]` is n-1 here. */
export function collectSearchSources(blocks: Iterable<Block>): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const block of blocks) {
    const preview: ToolPreview | undefined = block.tool?.preview;
    if (preview?.kind !== "search" || !preview.sources) continue;
    for (const source of preview.sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      out.push(source);
    }
  }
  return out;
}

/** A web search row: its pages came back, or the tool that ran it searches the web. */
export function isWebSearchBlock(block: Block): boolean {
  const preview = block.tool?.preview;
  if (preview?.kind !== "search") return false;
  return !!preview.sources?.length || isWebSearchName(preview.title);
}
