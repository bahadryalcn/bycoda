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
    const cache = new PersistenceBaselines(1_000_000, 1, 0);
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

  it("keeps the just-set oversized transcript normalized while stubbing older entries", () => {
    const cache = new PersistenceBaselines(100, 16, 0);
    cache.set("older", baseline("y", 3));
    cache.set("large", baseline("x".repeat(1000), 4));
    expect(cache.get("large")?.normalized).toBe(true);
    expect(cache.get("large")?.blocks).toHaveLength(1);
    expect(cache.get("older")).toEqual({
      blocks: [],
      revision: 3,
      updatedAt: 123,
      writes: 2,
      normalized: false,
    });
  });

  it("keeps two large busy sessions normalized while they alternate writes", () => {
    let now = 0;
    const cache = new PersistenceBaselines(1000, 16, 30_000, () => now);
    const text = "z".repeat(400);
    for (let tick = 0; tick < 6; tick += 1) {
      now += 1500;
      const id = tick % 2 === 0 ? "busy-a" : "busy-b";
      cache.set(id, baseline(text, tick + 1));
      // Neither stubs the other, so neither falls back to a full-transcript save.
      for (const busy of ["busy-a", "busy-b"].slice(0, Math.min(2, tick + 1)))
        expect(cache.get(busy)?.normalized).toBe(true);
    }
  });

  it("evicts a large baseline once it has gone cold", () => {
    let now = 0;
    const cache = new PersistenceBaselines(1000, 16, 30_000, () => now);
    const text = "z".repeat(400);
    cache.set("idle", baseline(text, 1));
    now += 31_000;
    cache.set("busy", baseline(text, 2));
    expect(cache.get("idle")?.normalized).toBe(false);
    expect(cache.get("busy")?.normalized).toBe(true);
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
