import type { Block } from "./session";
import { groupTurnItems, groupTurnsStable, type TurnItem } from "./transcriptActivity";

/** Reuse unchanged history while immutable updates replace the live blocks. */
export class TranscriptTurnCache {
  private blocks: Block[] | undefined;
  private managed = false;
  private turns: Block[][] = [];
  private items = new WeakMap<Block[], Map<boolean, TurnItem[]>>();

  group(blocks: Block[], managed = false): Block[][] {
    if (this.blocks === blocks && this.managed === managed) return this.turns;
    // Text-only streaming frames reuse every turn array but the live one.
    this.turns = groupTurnsStable(blocks, managed, this.turns);
    this.blocks = blocks;
    this.managed = managed;
    return this.turns;
  }

  turnItems(turn: Block[], settled: boolean): TurnItem[] {
    let variants = this.items.get(turn);
    const previous = variants?.get(settled);
    if (previous) return previous;
    const items = groupTurnItems(
      turn.filter((block) => !block.orchestration),
      { settled },
    );
    if (!variants) {
      variants = new Map();
      this.items.set(turn, variants);
    }
    variants.set(settled, items);
    return items;
  }
}
