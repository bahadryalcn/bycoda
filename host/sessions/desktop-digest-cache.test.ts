import { describe, expect, it } from "vitest";
import type { Block } from "../../src/features/sessions/model/session";
import { transcriptDigests } from "../../src/features/sync/model/conversationDigest";
import {
  buildChains,
  chainAt,
  headOfDigests,
  rememberChains,
} from "../../src/features/sync/model/conversationHead";
import {
  desktopDigests,
  forgetDesktopDigests,
  heldDigests,
  recordAgreed,
  rememberHeld,
  sameByRevisions,
} from "./desktop-digest-cache";

type Snapshot = { session: { blocks: Block[] }; blockRevisions?: Record<string, number> };

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Desktop rows: a block keeps its revision while its stored JSON is unchanged. */
function desktopRows() {
  let counter = 0;
  let rows: { json: string; revision: number }[] = [];
  return {
    checkpoint(blocks: Block[]): Snapshot {
      rows = blocks.map((block, index) => {
        const json = JSON.stringify(block);
        const old = rows[index];
        return old && old.json === json ? old : { json, revision: ++counter };
      });
      return {
        session: { blocks: structuredClone(blocks) },
        blockRevisions: Object.fromEntries(
          blocks.map((block, index) => [block.id, rows[index].revision]),
        ),
      };
    },
  };
}

function blocksOf(count: number, prefix = "b"): Block[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    role: index % 2 ? "assistant" : "user",
    text: `text ${index}`,
  })) as Block[];
}

/** Computes the digests of `snapshot` (twice, so the second call is the unchanged path) and records the agreement. */
function agree(owner: object, sessionId: string, hostRevision: number, snapshot: Snapshot) {
  desktopDigests(owner, sessionId, snapshot.session.blocks, snapshot.blockRevisions);
  desktopDigests(owner, sessionId, snapshot.session.blocks, snapshot.blockRevisions);
  recordAgreed(owner, sessionId, hostRevision, snapshot);
}

describe("desktopDigests", () => {
  it("equals transcriptDigests after random edit sequences with desktop revisions", () => {
    const random = mulberry32(20261106);
    const owner = {};
    const rows = desktopRows();
    let blocks = blocksOf(12);
    let nextId = 100;
    for (let step = 0; step < 300; step++) {
      const roll = random();
      const at = Math.floor(random() * Math.max(blocks.length, 1));
      if (roll < 0.2 || blocks.length === 0) {
        blocks.push({ id: `n${nextId++}`, role: "user", text: `added ${step}` } as Block);
      } else if (roll < 0.3) {
        blocks.splice(at, 1);
      } else if (roll < 0.4 && blocks.length > 1) {
        const other = Math.floor(random() * blocks.length);
        [blocks[at], blocks[other]] = [blocks[other], blocks[at]];
      } else if (roll < 0.6) {
        blocks[at] = { ...blocks[at], text: `${blocks[at].text ?? ""}+` } as Block;
      } else if (roll < 0.7) {
        // Same-length edit: only the revision tells it apart.
        const text = blocks[at].text ?? "";
        blocks[at] = { ...blocks[at], text: `${text.slice(1)}${text.slice(0, 1)}` } as Block;
      } else if (roll < 0.8) {
        blocks[at] = { ...blocks[at], tool: { detail: `d${step}` } } as Block;
      } else if (roll < 0.85) {
        blocks = blocks.map((block) => ({ ...block })) as Block[];
      }
      const snapshot = rows.checkpoint(blocks);
      expect(desktopDigests(owner, "s", snapshot.session.blocks, snapshot.blockRevisions)).toEqual(
        transcriptDigests(snapshot.session.blocks),
      );
    }
  });

  it("falls back to transcriptDigests when a duplicate id is injected", () => {
    const random = mulberry32(4242);
    const owner = {};
    const rows = desktopRows();
    let blocks = blocksOf(20);
    for (let step = 0; step < 120; step++) {
      const at = Math.floor(random() * blocks.length);
      if (random() < 0.3) {
        // A copy of another block's id: the revisions cannot tell the two apart.
        const source = blocks[Math.floor(random() * blocks.length)];
        blocks = [
          ...blocks.slice(0, at),
          { ...source, text: `dup ${step}` } as Block,
          ...blocks.slice(at),
        ];
      } else {
        blocks[at] = { ...blocks[at], text: `edit ${step}` } as Block;
      }
      const snapshot = rows.checkpoint(blocks);
      expect(desktopDigests(owner, "s", snapshot.session.blocks, snapshot.blockRevisions)).toEqual(
        transcriptDigests(snapshot.session.blocks),
      );
      if (blocks.length > 60) blocks = blocksOf(20, `r${step}-`);
    }
  });

  it("rehashes when the revision is unchanged but role or text length differ", () => {
    const owner = {};
    const revisions = { x: 1 };
    desktopDigests(owner, "s", [{ id: "x", role: "user", text: "hello" }] as Block[], revisions);
    const otherRole = [{ id: "x", role: "assistant", text: "hello" }] as Block[];
    expect(desktopDigests(owner, "s", otherRole, revisions)).toEqual(transcriptDigests(otherRole));
    const longer = [{ id: "x", role: "user", text: "hello!" }] as Block[];
    expect(desktopDigests(owner, "s", longer, revisions)).toEqual(transcriptDigests(longer));
  });

  it("falls back to transcriptDigests without usable revisions and records no agreement", () => {
    const owner = {};
    const blocks = blocksOf(3);
    const duplicate = [...blocks, { ...blocks[0] }] as Block[];
    const empty = [...blocks, { id: "", role: "user", text: "" }] as Block[];
    expect(desktopDigests(owner, "s", blocks, undefined)).toEqual(transcriptDigests(blocks));
    expect(desktopDigests(owner, "s", duplicate, { b0: 1, b1: 2, b2: 3 })).toEqual(
      transcriptDigests(duplicate),
    );
    expect(desktopDigests(owner, "s", empty, { b0: 1, b1: 2, b2: 3, "": 4 })).toEqual(
      transcriptDigests(empty),
    );
    expect(desktopDigests(owner, "s", blocks, { b0: 1, b1: 2, extra: 3 })).toEqual(
      transcriptDigests(blocks),
    );
    // Revisions that do not cover the blocks never create an agreement.
    const invalid = { session: { blocks: duplicate }, blockRevisions: { b0: 1, b1: 2, b2: 3 } };
    recordAgreed(owner, "s", 1, invalid);
    expect(
      sameByRevisions(owner, "s", { revision: 1, session: { blocks: duplicate } }, invalid),
    ).toBe(false);
    const emptyId = { session: { blocks: [{ id: "" }] as Block[] }, blockRevisions: { "": 1 } };
    recordAgreed(owner, "s", 1, emptyId);
    expect(
      sameByRevisions(
        owner,
        "s",
        { revision: 1, session: { blocks: emptyId.session.blocks } },
        emptyId,
      ),
    ).toBe(false);
  });

  it("returns undefined for a shrunk block without a digest, and uses the projected digest otherwise", () => {
    const owner = {};
    const revisions = { a: 1, b: 2 };
    const bare = [
      { id: "a", role: "assistant", text: "", remoteContent: { revision: 1, bytes: 9 } },
      { id: "b", role: "user", text: "ok" },
    ] as Block[];
    expect(desktopDigests(owner, "s", bare, revisions)).toBeUndefined();
    const projected = [
      {
        id: "a",
        role: "assistant",
        text: "",
        remoteContent: { revision: 1, bytes: 9, digest: "abc" },
      },
      { id: "b", role: "user", text: "ok" },
    ] as Block[];
    const digests = desktopDigests(owner, "s", projected, revisions);
    expect(digests).toEqual(transcriptDigests(projected));
    expect(digests).toContain("abc");
  });

  it("returns the same array while nothing changed, and a new one otherwise", () => {
    const owner = {};
    const rows = desktopRows();
    const first = rows.checkpoint(blocksOf(5));
    const before = desktopDigests(owner, "s", first.session.blocks, first.blockRevisions);
    const again = rows.checkpoint(blocksOf(5));
    const same = desktopDigests(owner, "s", again.session.blocks, again.blockRevisions);
    expect(same).toBe(before);
    const edited = blocksOf(5);
    edited[2] = { ...edited[2], text: "changed" } as Block;
    const changed = rows.checkpoint(edited);
    const after = desktopDigests(owner, "s", changed.session.blocks, changed.blockRevisions);
    expect(after).not.toBe(before);
    expect(after).toEqual(transcriptDigests(edited));
  });

  it("notices a change to a block that takes no part in comparison", () => {
    const owner = {};
    const rows = desktopRows();
    const pending = (text: string) =>
      [
        { id: "u", role: "user", text: "hi" },
        { id: "p", role: "approval", text, approval: { decided: false } },
      ] as Block[];
    const first = rows.checkpoint(pending("a"));
    agree(owner, "s", 1, first);
    const next = rows.checkpoint(pending("b"));
    desktopDigests(owner, "s", next.session.blocks, next.blockRevisions);
    expect(
      sameByRevisions(owner, "s", { revision: 1, session: { blocks: next.session.blocks } }, next),
    ).toBe(false);
  });
});

describe("sameByRevisions", () => {
  const pair = () => {
    const blocks = blocksOf(4);
    const current = { revision: 5, session: { blocks: structuredClone(blocks) } };
    const snapshot: Snapshot = {
      session: { blocks: structuredClone(blocks) },
      blockRevisions: { b0: 1, b1: 1, b2: 1, b3: 1 },
    };
    return { current, snapshot };
  };

  it("is true only when host revision, order, length and every block revision match", () => {
    const owner = {};
    const { current, snapshot } = pair();
    agree(owner, "s", 5, snapshot);
    const same = (): Snapshot => ({
      session: { blocks: structuredClone(snapshot.session.blocks) },
      blockRevisions: { ...snapshot.blockRevisions },
    });
    const check = (
      candidate: { revision: number; session: { blocks: Block[] } },
      next: Snapshot,
    ) => {
      desktopDigests(owner, "s", next.session.blocks, next.blockRevisions);
      return sameByRevisions(owner, "s", candidate, next);
    };
    expect(check(current, same())).toBe(true);
    expect(check({ ...current, revision: 6 }, same())).toBe(false);
    const appended = same();
    appended.session.blocks.push({ id: "b4", role: "user", text: "" } as Block);
    expect(check(current, appended)).toBe(false);
    const edited = same();
    edited.blockRevisions = { ...edited.blockRevisions, b2: 2 };
    expect(check(current, edited)).toBe(false);
    const reordered = same();
    [reordered.session.blocks[0], reordered.session.blocks[1]] = [
      reordered.session.blocks[1],
      reordered.session.blocks[0],
    ];
    expect(check(current, reordered)).toBe(false);
    expect(check(current, { session: same().session })).toBe(false);
  });

  it("is true only when the full structural comparison agrees", () => {
    const owner = {};
    const rows = desktopRows();
    const random = mulberry32(7);
    let host = blocksOf(6);
    let hostRevision = 9;
    agree(owner, "s", hostRevision, rows.checkpoint(host));
    for (let step = 0; step < 150; step++) {
      const next = structuredClone(host);
      if (random() < 0.5) next[Math.floor(random() * next.length)].text = `t${step}`;
      const snapshot = rows.checkpoint(next);
      desktopDigests(owner, "s", snapshot.session.blocks, snapshot.blockRevisions);
      const fast = sameByRevisions(
        owner,
        "s",
        { revision: hostRevision, session: { blocks: host } },
        snapshot,
      );
      if (fast) expect(JSON.stringify(snapshot.session.blocks)).toBe(JSON.stringify(host));
      // The host accepts the snapshot: a changed transcript gets a new host revision.
      if (JSON.stringify(next) !== JSON.stringify(host)) {
        host = next;
        hostRevision++;
      }
      recordAgreed(owner, "s", hostRevision, snapshot);
    }
  });

  it("is false for a snapshot that desktopDigests has not run on", () => {
    const owner = {};
    const { current, snapshot } = pair();
    agree(owner, "s", 5, snapshot);
    const copy: Snapshot = {
      session: { blocks: structuredClone(snapshot.session.blocks) },
      blockRevisions: { ...snapshot.blockRevisions },
    };
    expect(sameByRevisions(owner, "s", current, copy)).toBe(false);
    desktopDigests(owner, "s", copy.session.blocks, copy.blockRevisions);
    expect(sameByRevisions(owner, "s", current, copy)).toBe(true);
  });

  it("forgets an agreement after an unrecorded change, even if the change is later undone", () => {
    const owner = {};
    const { current, snapshot } = pair();
    agree(owner, "s", 5, snapshot);
    const changed: Snapshot = {
      session: { blocks: structuredClone(snapshot.session.blocks) },
      blockRevisions: { ...snapshot.blockRevisions, b1: 7 },
    };
    desktopDigests(owner, "s", changed.session.blocks, changed.blockRevisions);
    const undone: Snapshot = {
      session: { blocks: structuredClone(snapshot.session.blocks) },
      blockRevisions: { ...snapshot.blockRevisions },
    };
    desktopDigests(owner, "s", undone.session.blocks, undone.blockRevisions);
    expect(sameByRevisions(owner, "s", current, undone)).toBe(false);
  });

  it("forgets a session on request", () => {
    const owner = {};
    const { current, snapshot } = pair();
    agree(owner, "s", 5, snapshot);
    forgetDesktopDigests(owner, "s");
    expect(sameByRevisions(owner, "s", current, snapshot)).toBe(false);
  });
});

describe("prefix chains", () => {
  const alphabet = ["a", "b", "c", "", "ab"];
  const randomDigests = (random: () => number, length: number) =>
    Array.from({ length }, () => {
      const pick = Math.floor(random() * alphabet.length);
      return `${alphabet[pick]}${Math.floor(random() * 3)}`;
    });

  it("chainAt with a remembered chain equals chainAt without one for every count", () => {
    const random = mulberry32(99);
    for (let round = 0; round < 60; round++) {
      const digests = randomDigests(random, Math.floor(random() * 30));
      const plain = [...digests];
      rememberChains(digests, buildChains(digests));
      for (let count = 0; count <= digests.length + 2; count++)
        expect(chainAt(digests, count)).toBe(chainAt(plain, count));
      expect(chainAt(digests)).toBe(chainAt(plain));
    }
  });

  it("buildChains with a previous prefix equals buildChains from scratch", () => {
    const random = mulberry32(5);
    for (let round = 0; round < 200; round++) {
      const previous = randomDigests(random, Math.floor(random() * 25));
      const previousChains = buildChains(previous);
      const next = [...previous];
      const cut = Math.floor(random() * (next.length + 1));
      next.splice(
        cut,
        Math.floor(random() * 3),
        ...randomDigests(random, Math.floor(random() * 4)),
      );
      expect(buildChains(next, previous, previousChains)).toEqual(buildChains(next));
    }
  });
});

describe("heldDigests", () => {
  it("returns the same array for the same blocks, recomputes for a new array, and can be seeded", () => {
    const blocks = blocksOf(4);
    const first = heldDigests(blocks);
    expect(first).toEqual(transcriptDigests(blocks));
    expect(heldDigests(blocks)).toBe(first);
    const other = structuredClone(blocks);
    const second = heldDigests(other);
    expect(second).toEqual(transcriptDigests(other));
    expect(second).not.toBe(first);
    const seeded = structuredClone(blocks);
    const digests = transcriptDigests(seeded) as string[];
    rememberHeld(seeded, digests);
    expect(heldDigests(seeded)).toBe(digests);
    expect(headOfDigests(digests).chain).toBe(chainAt([...digests]));
  });

  it("returns undefined for a held transcript that cannot be compared", () => {
    const blocks = [
      { id: "a", role: "assistant", text: "", remoteContent: { revision: 1, bytes: 9 } },
    ] as Block[];
    expect(heldDigests(blocks)).toBeUndefined();
  });
});

describe("cache budget", () => {
  it("evicts the least recently used session beyond 64 sessions", () => {
    const owner = {};
    const blocks = [{ id: "a", role: "user", text: "" }] as Block[];
    const snapshot = { session: { blocks }, blockRevisions: { a: 1 } };
    const current = { revision: 1, session: { blocks } };
    for (let index = 0; index < 65; index++) agree(owner, `s${index}`, 1, snapshot);
    expect(sameByRevisions(owner, "s0", current, snapshot)).toBe(false);
    expect(sameByRevisions(owner, "s1", current, snapshot)).toBe(true);
    expect(sameByRevisions(owner, "s64", current, snapshot)).toBe(true);
  });

  it("evicts the oldest sessions beyond 200000 blocks", () => {
    const owner = {};
    const blocks = blocksOf(30_000, "p");
    const snapshot = {
      session: { blocks },
      blockRevisions: Object.fromEntries(blocks.map((block) => [block.id, 1])),
    };
    const current = { revision: 1, session: { blocks } };
    for (let index = 0; index < 8; index++) agree(owner, `big${index}`, 1, snapshot);
    expect(sameByRevisions(owner, "s-missing", current, snapshot)).toBe(false);
    expect(sameByRevisions(owner, "big0", current, snapshot)).toBe(false);
    expect(sameByRevisions(owner, "big7", current, snapshot)).toBe(true);
  });
});
