import { describe, expect, it } from "vitest";
import { PersistenceBaselines, type PersistenceBaseline } from "./persistenceBaselines";
import type { Block } from "../model/session";

function baseline(text: string, revision: number): PersistenceBaseline {
  const block: Block = { id: "b", role: "assistant", text };
  return {
    blocks: [{ source: block, value: block }],
    revision,
    updatedAt: 123,
    writes: 2,
    normalized: true,
  };
}

describe("persistence baseline retention", () => {
  it("drops old block graphs but preserves revision and timestamp for guarded checkpoints", () => {
    const cache = new PersistenceBaselines(1_000_000, 1);
    cache.set("old", baseline("old", 7));
    cache.set("active", baseline("new", 8));
    expect(cache.get("old")).toEqual({
      blocks: [],
      revision: 7,
      updatedAt: 123,
      writes: 2,
      normalized: false,
    });
    expect(cache.get("active")?.normalized).toBe(true);
    cache.set("old", baseline("next", 9));
    expect(cache.get("active")?.blocks).toEqual([]);
    expect(cache.get("old")?.revision).toBe(9);
  });

  it("does not retain a single oversized transcript", () => {
    const cache = new PersistenceBaselines(100, 16);
    cache.set("large", baseline("x".repeat(1000), 4));
    expect(cache.get("large")?.blocks).toEqual([]);
    expect(cache.get("large")?.revision).toBe(4);
    expect(cache.get("large")?.normalized).toBe(false);
  });

  it("releases accounting on delete and clear", () => {
    const cache = new PersistenceBaselines(1000, 1);
    cache.set("a", baseline("a", 1));
    cache.delete("a");
    cache.set("b", baseline("b", 2));
    expect(cache.get("b")?.normalized).toBe(true);
    cache.clear();
    cache.set("c", baseline("c", 3));
    expect(cache.size).toBe(1);
    expect(cache.get("c")?.normalized).toBe(true);
  });
});
