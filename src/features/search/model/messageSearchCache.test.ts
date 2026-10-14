import { describe, expect, it } from "vitest";
import { SessionMessageSearch } from "./appSearch";
import { registerStreamingTextUpdate } from "../../sessions/model/stableBlocks";
import type { Block } from "../../sessions/model/session";

const session = (blocks: Block[]) => ({
  id: "s",
  cwd: "/project",
  harness: "codex" as const,
  title: "Search",
  updatedAt: 1,
  blocks,
});

describe("incremental message search", () => {
  it("does not read unchanged historical text again during streaming", () => {
    let reads = 0;
    const history = Array.from({ length: 200 }, (_, index) => ({
      id: `history-${index}`,
      role: "assistant" as const,
      get text() {
        reads++;
        return "unchanged history";
      },
    }));
    const tail: Block = { id: "tail", role: "assistant", text: "waiting", streaming: true };
    const initial = [...history, tail];
    const search = new SessionMessageSearch();
    expect(search.search([session(initial)], "target")).toEqual([]);
    const initialReads = reads;
    const next = [...history, { ...tail, text: "target" }];
    registerStreamingTextUpdate(initial, next, initial.length - 1);
    expect(search.search([session(next)], "target").map((hit) => hit.blockId)).toEqual(["tail"]);
    expect(reads).toBe(initialReads);
    const final = [...history, { ...tail, text: "no match now" }];
    registerStreamingTextUpdate(next, final, next.length - 1);
    expect(search.search([session(final)], "target")).toEqual([]);
    expect(reads).toBe(initialReads);
  });

  it("reconciles edits, insertions, deletions and query changes", () => {
    const search = new SessionMessageSearch();
    const a: Block = { id: "a", role: "user", text: "alpha" };
    const b: Block = { id: "b", role: "assistant", text: "beta" };
    expect(search.search([session([a, b])], "alpha").map((hit) => hit.blockId)).toEqual(["a"]);
    const edited = { ...b, text: "alpha beta" };
    expect(search.search([session([a, edited])], "alpha").map((hit) => hit.blockId)).toEqual([
      "a",
      "b",
    ]);
    expect(search.search([session([edited])], "alpha").map((hit) => hit.blockId)).toEqual(["b"]);
    expect(search.search([session([edited, a])], "beta").map((hit) => hit.blockId)).toEqual(["b"]);
    expect(search.search([], "beta")).toEqual([]);
    expect(
      search.search([session([{ ...a, text: "beta" }])], "beta").map((hit) => hit.blockId),
    ).toEqual(["a"]);
  });

  it("uses current session metadata for cached matches", () => {
    const search = new SessionMessageSearch();
    const current = session([{ id: "a", role: "assistant", text: "target" }]);
    search.search([current], "target");
    const result = search.search(
      [{ ...current, title: "Renamed", cwd: "/new", updatedAt: 100 }],
      "target",
    );
    expect(result[0]).toMatchObject({ title: "Renamed", cwd: "/new", updatedAt: 100 });
    expect(search.search([current], " ")).toEqual([]);
  });
});
