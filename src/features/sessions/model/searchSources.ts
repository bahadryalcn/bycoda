import type { SearchSource } from "../../../shared/model/searchSources";
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
