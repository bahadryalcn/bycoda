import { describe, expect, it } from "vitest";
import { buildSessionBlockDelta, type PersistedBlock } from "./sessionDelta";
import type { Block } from "../model/session";
const item = (id: string, text = id): PersistedBlock => {
  const source: Block = { id, role: "assistant", text };
  return { source, value: source };
};
describe("incremental persisted blocks", () => {
  it("sends only the changed tail in a large immutable history", () => {
    const previous = Array.from({ length: 10000 }, (_, index) => item(String(index)));
    const next = [...previous];
    next[9999] = item("9999", "updated");
    const delta = buildSessionBlockDelta(previous, next);
    expect(delta.length).toBe(10000);
    expect(delta.changes).toEqual([{ index: 9999, block: next[9999].value }]);
  });
  it("represents reorder, insertion and truncation without stale trailing rows", () => {
    const a = item("a"),
      b = item("b"),
      c = item("c");
    expect(
      buildSessionBlockDelta([a, b], [b, a, c]).changes.map((change) => change.block.id),
    ).toEqual(["b", "a", "c"]);
    expect(buildSessionBlockDelta([a, b], [a])).toEqual({ length: 1, changes: [] });
  });
});
