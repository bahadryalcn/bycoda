import type { Block } from "../model/session";
import { streamingTextUpdate } from "../model/stableBlocks";

/**
 * The ids of blocks that already had output in a committed frame, so a block
 * mounting later knows whether to play its reveal. Mutated only from a commit
 * effect through `update`; render reads it through `has`.
 */
export class SeenOutput {
  private readonly ids: Set<string>;
  private previous: Block[] | null = null;

  constructor(blocks: Block[]) {
    this.ids = new Set(blocks.filter((block) => block.text).map((block) => block.id));
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** Records the blocks of a committed frame. */
  update(blocks: Block[]): void {
    const previous = this.previous;
    this.previous = blocks;
    const update = previous ? streamingTextUpdate(previous, blocks) : undefined;
    if (update !== undefined && blocks[update]) {
      // A text-only streaming frame can only add the streamed block's id.
      if (blocks[update].text) this.ids.add(blocks[update].id);
      return;
    }
    // Keep only the loaded page's ids: paging must not create an unbounded cache.
    this.ids.clear();
    for (const block of blocks) if (block.text) this.ids.add(block.id);
  }
}
