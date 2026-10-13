import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { registerStreamingTextUpdate, sameBlocksIgnoringStreamingText } from "./stableBlocks";
import { groupTurns, groupTurnsStable, lastTurn } from "./transcriptActivity";
describe("trusted incremental turn grouping", () => {
  const base: Block[] = [
    { id: "u", role: "user", text: "prompt" },
    { id: "a", role: "assistant", text: "a", streaming: true },
  ];
  it("updates trusted text while preserving full grouping semantics", () => {
    const first = groupTurnsStable(base, false, []);
    const next = [...base];
    next[1] = { ...base[1], text: "ab" };
    registerStreamingTextUpdate(base, next, 1);
    expect(sameBlocksIgnoringStreamingText(base, next)).toBe(true);
    expect(groupTurnsStable(next, false, first)).toEqual(groupTurns(next));
  });
  it("falls back on unknown prefix edits and missed intermediate revisions", () => {
    const first = groupTurnsStable(base, false, []);
    const middle = [...base];
    middle[1] = { ...base[1], text: "ab" };
    registerStreamingTextUpdate(base, middle, 1);
    const next = [...middle];
    next[1] = { ...middle[1], text: "abc" };
    registerStreamingTextUpdate(middle, next, 1);
    expect(groupTurnsStable(next, false, first)).toEqual(groupTurns(next));
    const edited = [...next];
    edited[0] = { ...base[0], role: "handoff" };
    expect(groupTurnsStable(edited, false, first)).toEqual(groupTurns(edited));
    expect(sameBlocksIgnoringStreamingText(base, edited)).toBe(false);
  });
  it("preserves managed internal and handoff behavior", () => {
    const blocks: Block[] = [
      { id: "h", role: "handoff", text: "handoff" },
      { ...base[0], internal: true },
      base[1],
    ];
    for (const managed of [true, false]) {
      const first = groupTurnsStable(blocks, managed, []);
      const next = [...blocks];
      next[2] = { ...base[1], text: "ab" };
      registerStreamingTextUpdate(blocks, next, 2);
      expect(groupTurnsStable(next, managed, first)).toEqual(groupTurns(next, managed));
    }
  });
});

describe("lastTurn", () => {
  const b = (id: string, role: Block["role"], extra: Partial<Block> = {}): Block =>
    ({ id, role, text: id, ...extra }) as Block;
  const cases: Record<string, Block[]> = {
    empty: [],
    plain: [b("u1", "user"), b("a1", "assistant"), b("u2", "user"), b("a2", "assistant")],
    leadingNonUser: [b("a0", "assistant"), b("t", "tool")],
    handoffMid: [b("u1", "user"), b("a1", "assistant"), b("h", "handoff"), b("a2", "assistant")],
    handoffLast: [b("u1", "user"), b("a1", "assistant"), b("h", "handoff")],
    internal: [
      b("u1", "user"),
      b("a1", "assistant"),
      b("i", "user", { internal: true }),
      b("a2", "assistant"),
    ],
    internalLast: [b("u1", "user"), b("i", "user", { internal: true })],
    onlyInternal: [b("i", "user", { internal: true })],
  };
  for (const managed of [false, true]) {
    for (const [name, blocks] of Object.entries(cases)) {
      it(`matches groupTurns (${name}, managed=${managed})`, () => {
        const turns = groupTurns(blocks, managed);
        expect(lastTurn(blocks, managed)).toEqual(turns[turns.length - 1] ?? []);
      });
    }
  }
});
