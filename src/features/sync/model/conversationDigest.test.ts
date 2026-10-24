import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import { blockDigest, conversationHead, transcriptDigests } from "./conversationDigest";
import {
  atHead,
  chainAt,
  chooseBase,
  hash128,
  headOfDigests,
  parseHead,
  reconcile,
  sameHead,
  type Reconciled,
} from "./conversationHead";

const user = (id: string, text = id): Block => ({ id, role: "user", text });

describe("hash128", () => {
  it("is stable, 128 bits wide and sensitive to every character", () => {
    expect(hash128("abc")).toBe(hash128("abc"));
    expect(hash128("abc")).toMatch(/^[0-9a-f]{32}$/);
    expect(hash128("abc")).not.toBe(hash128("abd"));
    expect(hash128("ab")).not.toBe(hash128("ba"));
    expect(hash128("")).toMatch(/^[0-9a-f]{32}$/);
  });
  it("has no collisions among many similar short strings", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(hash128(`block-${i}`));
    expect(seen.size).toBe(20_000);
  });
});

describe("block digests", () => {
  it("ignore key order, a finished stream flag and local bookkeeping", () => {
    const a: Block = { id: "a", role: "user", text: "hi", startedAt: 1, durationMs: 5 };
    const b = { text: "hi", role: "user", id: "a", streaming: false, providerTurnId: "t" } as Block;
    expect(blockDigest(a)).toBe(blockDigest(b));
    // An open stream is content; bookkeeping on an assistant block is too.
    expect(blockDigest({ ...b, streaming: true })).not.toBe(blockDigest(b));
    const reply: Block = { id: "r", role: "assistant", text: "x" };
    expect(blockDigest({ ...reply, durationMs: 5 })).not.toBe(blockDigest(reply));
  });

  it("trust the digest a shrunk block carries, and refuse one without", () => {
    const full: Block = { id: "a", role: "assistant", text: "long ".repeat(10) };
    const shrunk: Block = {
      id: "a",
      role: "assistant",
      text: "long…",
      remoteContent: { revision: 1, bytes: 50, digest: blockDigest(full) },
    };
    expect(blockDigest(shrunk)).toBe(blockDigest(full));
    expect(transcriptDigests([shrunk])).toEqual([blockDigest(full)]);
    const noDigest = { ...shrunk, remoteContent: { revision: 1, bytes: 50 } };
    expect(transcriptDigests([user("u"), noDigest])).toBeUndefined();
    expect(conversationHead([noDigest])).toBeUndefined();
  });

  it("leave out quit notices and undecided approvals", () => {
    const quit: Block = {
      id: "q",
      role: "system",
      text: "Turn interrupted when bycoda quit.",
      notice: "interrupt",
    };
    const pending: Block = { id: "p", role: "approval", text: "Run?", approval: {} as never };
    const decided: Block = {
      id: "d",
      role: "approval",
      text: "Run?",
      approval: { decided: true } as never,
    };
    expect(transcriptDigests([user("a"), quit, pending, decided])).toEqual([
      blockDigest(user("a")),
      blockDigest(decided),
    ]);
    expect(conversationHead([user("a"), quit])).toEqual(conversationHead([user("a")]));
  });
});

describe("heads", () => {
  const digests = ["a", "b", "c"].map((text) => hash128(text));
  it("name a transcript by its count and chain", () => {
    const head = headOfDigests(digests);
    expect(head).toEqual({ count: 3, chain: chainAt(digests) });
    expect(atHead(digests, head)).toBe(true);
    expect(atHead(digests.slice(0, 2), head)).toBe(false);
    expect(atHead([...digests.slice(0, 2), hash128("z")], head)).toBe(false);
    expect(headOfDigests([])).toEqual({ count: 0, chain: "" });
    expect(chainAt(digests, 2)).toBe(chainAt(digests.slice(0, 2)));
    expect(sameHead(head, { ...head })).toBe(true);
    expect(sameHead(head, undefined)).toBe(false);
  });
  it("are read back only when well formed", () => {
    const head = headOfDigests(digests);
    expect(parseHead(JSON.parse(JSON.stringify(head)))).toEqual(head);
    expect(parseHead({ count: 0, chain: "" })).toEqual({ count: 0, chain: "" });
    for (const bad of [
      undefined,
      null,
      [],
      "x",
      {},
      { count: -1, chain: head.chain },
      { count: 1.5, chain: head.chain },
      { count: 3, chain: "short" },
      { count: 3, chain: 5 },
      { count: 0, chain: head.chain },
      { count: 3, chain: "g".repeat(32) },
    ])
      expect(parseHead(bad)).toBeUndefined();
  });
  it("chooses the base that names the transcript, else the first usable one", () => {
    const old = headOfDigests(digests.slice(0, 1));
    const now = headOfDigests(digests);
    expect(chooseBase(digests, old, now)).toEqual(now);
    expect(chooseBase(digests, undefined, old)).toEqual(old);
    expect(chooseBase(digests, undefined, undefined)).toBeUndefined();
  });
});

describe("reconcile", () => {
  const d = (...names: string[]) => names.map((name) => hash128(name));
  const head = (...names: string[]) => headOfDigests(d(...names));
  type Row = [string, string[], string[], string[] | undefined, Reconciled];
  const table: Row[] = [
    // No base: one side containing the other is ahead, otherwise both are.
    ["same transcript", ["a", "b"], ["a", "b"], undefined, "equal"],
    ["both empty", [], [], undefined, "equal"],
    ["host appended", ["a"], ["a", "b"], undefined, "hostAhead"],
    ["local appended", ["a", "b"], ["a"], undefined, "localAhead"],
    ["host started, local empty", [], ["a"], undefined, "hostAhead"],
    ["both appended differently", ["a", "x"], ["a", "y"], undefined, "conflict"],
    ["same blocks, one changed", ["a", "x"], ["a", "b"], undefined, "conflict"],
    ["both appended, different length", ["a", "x"], ["a", "y", "z"], undefined, "conflict"],
    // With the head both last held:
    ["equal at the base", ["a", "b"], ["a", "b"], ["a", "b"], "equal"],
    ["equal after both moved the same way", ["a", "b", "c"], ["a", "b", "c"], ["a"], "equal"],
    ["host moved on", ["a", "b"], ["a", "b", "c"], ["a", "b"], "hostAhead"],
    ["local moved on", ["a", "b", "c"], ["a", "b"], ["a", "b"], "localAhead"],
    ["host rewound, local untouched", ["a", "b", "c"], ["a"], ["a", "b", "c"], "hostAhead"],
    ["local rewound, host untouched", ["a"], ["a", "b", "c"], ["a", "b", "c"], "localAhead"],
    ["host reset to empty, local untouched", ["a", "b"], [], ["a", "b"], "hostAhead"],
    ["host edited a block, local untouched", ["a", "b"], ["a", "b2"], ["a", "b"], "hostAhead"],
    ["local edited a block, host untouched", ["a", "b2"], ["a", "b"], ["a", "b"], "localAhead"],
    ["both appended after the same base", ["a", "x"], ["a", "y"], ["a"], "conflict"],
    ["both appended, one after the other", ["a", "x"], ["a", "x", "y"], ["a"], "hostAhead"],
    ["both appended, lengths differ", ["a", "x", "z"], ["a", "y"], ["a"], "conflict"],
    ["both changed away from the base", ["a", "x"], ["a", "y"], ["a", "b"], "conflict"],
    ["base from another conversation", ["a", "b"], ["a", "b", "c"], ["q"], "hostAhead"],
    ["base from another conversation, diverged", ["a", "x"], ["a", "y"], ["q"], "conflict"],
    ["empty base, both appended", ["x"], ["y"], [], "conflict"],
    ["empty base, host appended", [], ["y"], [], "hostAhead"],
  ];
  it.each(table)("%s", (_name, local, host, base, expected) => {
    expect(reconcile(d(...local), d(...host), base && head(...base))).toBe(expected);
  });

  it("is symmetric: swapping the sides swaps the lead", () => {
    const swap: Record<Reconciled, Reconciled> = {
      equal: "equal",
      conflict: "conflict",
      localAhead: "hostAhead",
      hostAhead: "localAhead",
    };
    for (const [, local, host, base] of table)
      expect(reconcile(d(...host), d(...local), base && head(...base))).toBe(
        swap[reconcile(d(...local), d(...host), base && head(...base))],
      );
  });

  it("judges a long transcript quickly", () => {
    const long = Array.from({ length: 20_000 }, (_, i) => hash128(`b${i}`));
    const start = performance.now();
    expect(reconcile(long, [...long, hash128("more")], headOfDigests(long))).toBe("hostAhead");
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
