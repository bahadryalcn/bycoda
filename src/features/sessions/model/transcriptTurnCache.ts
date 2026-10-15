import { sameBlocksIgnoringStreamingText } from "./stableBlocks";
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

  private live?: { key: string; turn: Block[]; items: TurnItem[] };

  turnItems(turn: Block[], settled: boolean): TurnItem[] {
    let variants = this.items.get(turn);
    const previous = variants?.get(settled);
    if (previous) return previous;
    const key = `${turn[0]?.id}:${turn.length}`;
    const live = this.live;
    // Only a nonempty assistant tail is grouping-neutral. Reasoning, blank-to-
    // prose transitions and metadata edits must use the canonical grouper.
    const tail = turn[turn.length - 1];
    const oldTail = live?.turn[live.turn.length - 1];
    if (
      !settled &&
      live?.key === key &&
      tail?.role === "assistant" &&
      !!tail.text.trim() &&
      !!oldTail?.text.trim() &&
      sameBlocksIgnoringStreamingText(live.turn, turn)
    ) {
      const items = live.items.map((item) =>
        item.type === "block" && item.block === oldTail ? { ...item, block: tail } : item,
      );
      this.live = { key, turn, items };
      this.items.set(turn, new Map([[false, items]]));
      return items;
    }
    const items = groupTurnItems(
      turn.filter((block) => !block.orchestration),
      { settled },
    );
    if (!variants) {
      variants = new Map();
      this.items.set(turn, variants);
    }
    variants.set(settled, items);
    if (!settled) this.live = { key, turn, items };
    return items;
  }
}
