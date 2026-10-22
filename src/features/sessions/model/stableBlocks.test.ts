import { describe, expect, it } from "vitest";
import {
  sameBlocksIgnoringStreamingText,
  sameSessionIgnoringStreamingText,
  sameLastTurnRecall,
  shallowArrayEqual,
  registerStreamingTextUpdate,
  streamingTextUpdate,
} from "./stableBlocks";
import type { Block, Session } from "./session";

const user: Block = { id: "u1", role: "user", text: "hi" };
const reply: Block = { id: "a1", role: "assistant", text: "He", streaming: true };

describe("sameBlocksIgnoringStreamingText", () => {
  it("keeps a cumulative fast path while the shell retains an older array", () => {
    const initial = [user, reply];
    let previous = initial;
    for (let frame = 0; frame < 200; frame++) {
      const next = [user, { ...reply, text: `Frame ${frame}` }];
      registerStreamingTextUpdate(previous, next, 1);
      previous = next;
    }
    expect(streamingTextUpdate(initial, previous)).toBe(1);
    expect(sameBlocksIgnoringStreamingText(initial, previous)).toBe(true);
    expect(
      sameBlocksIgnoringStreamingText(initial, [user, { ...previous[1], streaming: false }]),
    ).toBe(false);
    expect(streamingTextUpdate(initial, [user, ...previous])).toBeUndefined();
  });

  it("does not carry a lineage across a changed block index or metadata boundary", () => {
    const reasoning: Block = { id: "r", role: "reasoning", text: "first", streaming: true };
    const initial = [reasoning, reply];
    const middle = [reasoning, { ...reply, text: "second" }];
    registerStreamingTextUpdate(initial, middle, 1);
    const next = [{ ...reasoning, text: "third" }, middle[1]];
    registerStreamingTextUpdate(middle, next, 0);
    const final = [{ ...next[0], text: "fourth" }, middle[1]];
    registerStreamingTextUpdate(next, final, 0);
    expect(streamingTextUpdate(middle, next)).toBe(0);
    expect(streamingTextUpdate(next, final)).toBe(0);
    expect(streamingTextUpdate(initial, final)).toBeUndefined();
    const changed = [reasoning, { ...reply, approval: { requestId: "a" } } as Block];
    const changedText = [reasoning, { ...changed[1], text: "fifth" }];
    registerStreamingTextUpdate(changed, changedText, 1);
    expect(sameBlocksIgnoringStreamingText(initial, changedText)).toBe(false);
  });

  it("ignores new text on the last streamed assistant block", () => {
    expect(
      sameBlocksIgnoringStreamingText([user, reply], [user, { ...reply, text: "Hello" }]),
    ).toBe(true);
  });

  it("sees any other change to the last block", () => {
    expect(
      sameBlocksIgnoringStreamingText(
        [user, reply],
        [user, { ...reply, text: "Hello", streaming: false }],
      ),
    ).toBe(false);
  });

  it("sees a changed earlier block, a new block, or a text change on a tool", () => {
    expect(
      sameBlocksIgnoringStreamingText([user, reply], [{ ...user }, { ...reply, text: "Hello" }]),
    ).toBe(false);
    expect(sameBlocksIgnoringStreamingText([user, reply], [user, reply, user])).toBe(false);
    const tool: Block = { id: "t1", role: "tool", text: "a" };
    expect(sameBlocksIgnoringStreamingText([tool], [{ ...tool, text: "ab" }])).toBe(false);
  });
});

describe("sameLastTurnRecall / shallowArrayEqual", () => {
  it("compares recall content, not identity", () => {
    const file = { id: "f" } as never;
    expect(
      sameLastTurnRecall({ text: "x", attachments: [file] }, { text: "x", attachments: [file] }),
    ).toBe(true);
    expect(sameLastTurnRecall({ text: "x", attachments: [] }, { text: "y", attachments: [] })).toBe(
      false,
    );
    expect(sameLastTurnRecall(null, null)).toBe(true);
    expect(sameLastTurnRecall(null, { text: "x", attachments: [] })).toBe(false);
  });

  it("treats equal-content arrays as equal", () => {
    expect(shallowArrayEqual(["a"], ["a"])).toBe(true);
    expect(shallowArrayEqual(["a"], ["b"])).toBe(false);
    expect(shallowArrayEqual(undefined, undefined)).toBe(true);
    expect(shallowArrayEqual(undefined, [])).toBe(false);
  });
});

it("drops only busy text frames, retaining settled edits and metadata updates", () => {
  const before = { id: "s", busy: true, blocks: [user, reply] } as Session;
  const after = { ...before, blocks: [user, { ...reply, text: "Hello" }] };
  expect(sameSessionIgnoringStreamingText(before, after)).toBe(true);
  expect(
    sameSessionIgnoringStreamingText(before, { ...after, pendingQuestion: {} } as Session),
  ).toBe(false);
  expect(
    sameSessionIgnoringStreamingText({ ...before, busy: false }, { ...after, busy: false }),
  ).toBe(false);
});
