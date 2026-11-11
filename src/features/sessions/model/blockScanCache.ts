import { executionUserIndex } from "./executionTurn";
import { harnessesForTurns } from "./secondOpinion";
import { hasPendingApproval, type Block, type HarnessId } from "./session";
import { streamingTextUpdate } from "./stableBlocks";

/**
 * When the live turn's clock started. A message sent while the agent is still
 * going (a steer, or a reply while background work runs) joins that run and
 * carries no clock of its own, so the clock keeps the time of the prompt that
 * started it. Without that the clock falls back to when it was drawn, and
 * starts over every time the transcript is shown again.
 */
export function turnClockStart(blocks: Block[], userBlock: Block | undefined): number | undefined {
  if (!userBlock || userBlock.startedAt != null) return userBlock?.startedAt;
  for (let i = blocks.indexOf(userBlock) - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && block.startedAt != null) {
      return block.startedAt;
    }
  }
  return undefined;
}

/** Whole-transcript facts a render needs; none depends on a block's text. */
export type BlockScan = {
  readonly blocks: Block[];
  readonly pendingApproval: boolean;
  readonly preparingHandoff: boolean;
  /** Index of the prompt that owns the run in flight, or -1. */
  readonly executionUser: number;
};

function fullScan(blocks: Block[]): BlockScan {
  return {
    blocks,
    pendingApproval: hasPendingApproval(blocks),
    preparingHandoff: blocks.some(
      (block) => block.role === "handoff" && block.handoff?.status === "preparing",
    ),
    executionUser: executionUserIndex(blocks),
  };
}

/**
 * Derives the transcript's whole-array facts once per structural change.
 * A text-only streaming frame cannot change an approval, a handoff, a user
 * block or the harness of a turn, so it reuses the previous result instead of
 * walking every block again. Hold one per transcript (in state); every value
 * stays a pure function of the blocks, so a discarded render is harmless.
 */
export class BlockScanCache {
  private last: BlockScan | undefined;
  private harnessMemo: { harness: HarnessId; ids: string[]; result: HarnessId[] } | undefined;
  private clockMemo: { user: Block | undefined; value: number | undefined } | undefined;

  scan(blocks: Block[]): BlockScan {
    const last = this.last;
    if (last?.blocks === blocks) return last;
    const index = last ? streamingTextUpdate(last.blocks, blocks) : undefined;
    // A streamed user block is rescanned: its identity feeds the user-based facts.
    if (last && index !== undefined && last.blocks[index]?.role !== "user") {
      this.last = { ...last, blocks };
    } else {
      this.last = fullScan(blocks);
      this.harnessMemo = undefined;
      this.clockMemo = undefined;
    }
    return this.last;
  }

  /** `harnessesForTurns`, reused while only streamed text changed and the turns are the same. */
  harnesses(blocks: Block[], turns: Block[][], harness: HarnessId): HarnessId[] {
    const ids = turns.map((turn) => turn[0]?.id ?? "");
    const memo = this.harnessMemo;
    const current = this.last?.blocks === blocks;
    if (
      current &&
      memo &&
      memo.harness === harness &&
      memo.ids.length === ids.length &&
      memo.ids.every((id, index) => id === ids[index])
    ) {
      return memo.result;
    }
    const result = harnessesForTurns(blocks, turns, harness);
    if (current) this.harnessMemo = { harness, ids, result };
    return result;
  }

  /** `turnClockStart`, reused for the same prompt while only streamed text changed. */
  clockStart(blocks: Block[], userBlock: Block | undefined): number | undefined {
    const memo = this.clockMemo;
    const current = this.last?.blocks === blocks;
    if (current && memo && memo.user === userBlock) return memo.value;
    const value = turnClockStart(blocks, userBlock);
    if (current) this.clockMemo = { user: userBlock, value };
    return value;
  }
}
