import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySessionOrder,
  loadSessionOrder,
  moveIdsInOrder,
  saveSessionOrder,
} from "./sessionOrder";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("session order", () => {
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps recency until arranged, then leads with sessions it has not seen", () => {
    expect(applySessionOrder(rows("a", "b", "c"), undefined).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(applySessionOrder(rows("new", "a", "b", "c"), ["c", "a", "b"]).map((r) => r.id)).toEqual(
      ["new", "c", "a", "b"],
    );
  });

  it("places moved ids relative to a session, not an index", () => {
    expect(moveIdsInOrder(["a", "b", "c", "d"], ["d"], "b", "before")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
    expect(moveIdsInOrder(["a", "b", "c", "d"], ["a", "c"], "d", "after")).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    // The anchor itself never moves; an unknown anchor appends.
    expect(moveIdsInOrder(["a", "b"], ["a", "b"], "b", "after")).toEqual(["b", "a"]);
    expect(moveIdsInOrder(["a"], ["x"], "missing", "before")).toEqual(["a", "x"]);
  });

  it("stores each project's lists separately", () => {
    saveSessionOrder("/work/one", { loose: ["b", "a"] });
    saveSessionOrder("/work/two", { pinned: ["p"] });
    expect(loadSessionOrder("/work/one")).toEqual({ loose: ["b", "a"] });
    expect(loadSessionOrder("/work/two")).toEqual({ pinned: ["p"] });
    saveSessionOrder("/work/one", {});
    expect(loadSessionOrder("/work/one")).toEqual({});
  });
});
