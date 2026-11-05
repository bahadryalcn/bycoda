import { describe, expect, it } from "vitest";
import type { Block } from "../../src/features/sessions/model/session";
import { transcriptDigests } from "../../src/features/sync/model/conversationDigest";
import { alignForDigest, refreshDigests } from "./refresh-digest-cache";

const blocks = (): Block[] => [
  { id: "a", role: "user", text: "first", startedAt: 1 } as Block,
  { id: "b", role: "assistant", text: "reply" },
  { id: "c", role: "user", text: "last!" },
];

function expectSameDigests(mine: Block[], held: Block[]) {
  const result = refreshDigests(mine, held);
  expect(result.mine).toEqual(transcriptDigests(mine));
  expect(result.held).toEqual(transcriptDigests(held));
}

describe("refreshDigests", () => {
  it("matches full digests for append", () => {
    const held = blocks();
    const mine = [...structuredClone(held), { id: "d", role: "assistant", text: "new" } as Block];
    expectSameDigests(mine, held);
  });

  it("matches full digests for a tail-text edit", () => {
    const held = blocks();
    const mine = structuredClone(held);
    mine[2].text = "last?";
    expectSameDigests(mine, held);
  });

  it("matches full digests for an earlier edit with the same length", () => {
    const held = blocks();
    const mine = structuredClone(held);
    mine[0].text = "other";
    expectSameDigests(mine, held);
  });

  it("matches full digests for deletion, reorder and middle insertion", () => {
    const held = blocks();
    expectSameDigests(structuredClone(held).slice(1), held);
    expectSameDigests([held[1], held[0], held[2]].map((b) => structuredClone(b)), held);
    const middle = structuredClone(held);
    middle.splice(1, 0, { id: "x", role: "assistant", text: "inserted" });
    expectSameDigests(middle, held);
  });

  it("returns undefined for a projection without a digest", () => {
    const held = blocks();
    const mine: Block[] = [
      { id: "p", role: "assistant", text: "preview", remoteContent: { revision: 1, bytes: 9 } },
    ];
    expect(refreshDigests(mine, held).mine).toBeUndefined();
    expect(refreshDigests(held, mine).held).toBeUndefined();
  });

  it("uses the projected digest for a shrunk block", () => {
    const held = blocks();
    const mine: Block[] = [
      {
        id: "a",
        role: "user",
        text: "",
        remoteContent: { revision: 1, bytes: 5, digest: "abc" },
      } as Block,
      ...structuredClone(held).slice(1),
    ];
    expectSameDigests(mine, held);
  });

  it("ignores user turn bookkeeping that differs between copies", () => {
    const held = blocks();
    const mine = structuredClone(held);
    (mine[0] as Block & { startedAt: number }).startedAt = 999;
    expectSameDigests(mine, held);
  });
});

describe("alignForDigest", () => {
  it("reuses host blocks for equal content and keeps changed desktop blocks", () => {
    const held = blocks();
    const mine = structuredClone(held);
    mine[1].text = "changed";
    mine.push({ id: "d", role: "assistant", text: "new" });
    const stable = alignForDigest(mine, held);
    expect(stable[0]).toBe(held[0]);
    expect(stable[1]).toBe(mine[1]);
    expect(stable[2]).toBe(held[2]);
    expect(stable[3]).toBe(mine[3]);
  });

  it("reuses the same object without comparing it", () => {
    const held = blocks();
    const stable = alignForDigest([...held], held);
    expect(stable).toEqual(held);
    expect(stable.every((block, index) => block === held[index])).toBe(true);
  });
});
