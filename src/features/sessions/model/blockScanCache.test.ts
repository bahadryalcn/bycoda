import { describe, expect, it } from "vitest";
import { BlockScanCache, turnClockStart } from "./blockScanCache";
import { executionUserIndex } from "./executionTurn";
import { harnessesForTurns } from "./secondOpinion";
import { hasPendingApproval, type Block, type HarnessId } from "./session";
import { registerStreamingTextUpdate } from "./stableBlocks";
import { groupTurns } from "./transcriptActivity";

const harnessA = "claude" as HarnessId;
const harnessB = "codex" as HarnessId;

function reference(blocks: Block[]) {
  return {
    pendingApproval: hasPendingApproval(blocks),
    preparingHandoff: blocks.some((b) => b.role === "handoff" && b.handoff?.status === "preparing"),
    executionUser: executionUserIndex(blocks),
  };
}

/** Counts reads of `role`, the field every whole-transcript scan touches. */
function counted(block: Block, counter: { reads: number }): Block {
  const copy = { ...block };
  const role = block.role;
  Object.defineProperty(copy, "role", {
    get() {
      counter.reads++;
      return role;
    },
    enumerable: true,
  });
  return copy;
}

function sequence(seed: number): Block[] {
  let state = seed;
  const rand = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const blocks: Block[] = [];
  for (let i = 0; i < 12; i++) {
    const r = rand();
    const id = `b${i}`;
    if (r < 0.25) blocks.push({ id, role: "user", text: id, startedAt: i });
    else if (r < 0.35)
      blocks.push({
        id,
        role: "user",
        text: id,
        continuationOf: blocks.find((b) => b.role === "user")?.id,
      });
    else if (r < 0.5)
      blocks.push({
        id,
        role: "assistant",
        text: id,
        approval: { requestId: 1, decided: rand() < 0.5 ? "allow" : undefined },
      } as Block);
    else if (r < 0.6)
      blocks.push({
        id,
        role: "handoff",
        text: "",
        handoff: { from: harnessA, to: harnessB, status: rand() < 0.5 ? "preparing" : "done" },
      } as Block);
    else blocks.push({ id, role: "assistant", text: id });
  }
  blocks.push({ id: "tail", role: "assistant", text: "t", streaming: true });
  return blocks;
}

function stream(previous: Block[]): Block[] {
  const next = previous.slice();
  const last = next.length - 1;
  next[last] = { ...previous[last], text: previous[last].text + "x" };
  registerStreamingTextUpdate(previous, next, last);
  return next;
}

describe("BlockScanCache", () => {
  it("matches the straightforward scan on arbitrary sequences, across text frames", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cache = new BlockScanCache();
      let blocks = sequence(seed);
      for (let frame = 0; frame < 4; frame++) {
        const scan = cache.scan(blocks);
        expect({
          pendingApproval: scan.pendingApproval,
          preparingHandoff: scan.preparingHandoff,
          executionUser: scan.executionUser,
        }).toEqual(reference(blocks));
        const turns = groupTurns(blocks, false);
        expect(cache.harnesses(blocks, turns, harnessA)).toEqual(
          harnessesForTurns(blocks, turns, harnessA),
        );
        expect(cache.harnesses(blocks, turns, harnessB)).toEqual(
          harnessesForTurns(blocks, turns, harnessB),
        );
        blocks = stream(blocks);
      }
    }
  });

  it("rescans when the change is not a registered text-only frame", () => {
    const cache = new BlockScanCache();
    const first: Block[] = [{ id: "u", role: "user", text: "q" }];
    expect(cache.scan(first).pendingApproval).toBe(false);
    const second = [
      ...first,
      { id: "a", role: "assistant", text: "", approval: { requestId: 1 } } as Block,
    ];
    expect(cache.scan(second).pendingApproval).toBe(true);
  });

  it("rescans when the streamed block is a user block", () => {
    const cache = new BlockScanCache();
    const first: Block[] = [{ id: "u1", role: "user", text: "q" }];
    const before = cache.scan(first);
    const second = stream(first);
    expect(cache.scan(second)).not.toBe(before);
    expect(cache.scan(second).executionUser).toBe(0);
  });

  it("does not walk the transcript for a text-only frame", () => {
    const counter = { reads: 0 };
    const base = sequence(7).map((block) => counted(block, counter));
    const cache = new BlockScanCache();
    cache.scan(base);
    cache.harnesses(base, groupTurns(base, false), harnessA);
    const next = stream(base);
    const nextTurns = groupTurns(next, false);
    counter.reads = 0;
    const scan = cache.scan(next);
    const result = cache.harnesses(next, nextTurns, harnessA);
    // One read: the role of the streamed block itself, independent of transcript length.
    expect(counter.reads).toBeLessThanOrEqual(1);
    expect(scan.blocks).toBe(next);
    expect(result).toEqual(harnessesForTurns(next, nextTurns, harnessA));
  });

  it("reuses the clock start across text frames and matches turnClockStart", () => {
    const cache = new BlockScanCache();
    const base: Block[] = [
      { id: "u1", role: "user", text: "a", startedAt: 5 },
      { id: "u2", role: "user", text: "b" },
      { id: "t", role: "assistant", text: "", streaming: true },
    ];
    cache.scan(base);
    expect(cache.clockStart(base, base[1])).toBe(turnClockStart(base, base[1]));
    const next = stream(base);
    cache.scan(next);
    expect(cache.clockStart(next, next[1])).toBe(5);
    expect(cache.clockStart(next, undefined)).toBeUndefined();
  });
});
