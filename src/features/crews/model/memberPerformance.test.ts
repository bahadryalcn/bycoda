import { describe, expect, it } from "vitest";
import { memberPerformance } from "./memberPerformance";

const candidate = (
  model: string,
  count: number,
  accepted: number,
  passed: number,
  harness = "codex",
) => ({ harness, model, observations: { count, accepted, passed } });

describe("memberPerformance", () => {
  it("reports no rates and an empty list when nothing was reviewed", () => {
    expect(memberPerformance([])).toEqual({
      reviewed: 0,
      firstPassRate: undefined,
      acceptedRate: undefined,
      perModel: [],
    });
    expect(memberPerformance([candidate("gpt-a", 0, 0, 0)]).perModel).toEqual([]);
    expect(memberPerformance([candidate("gpt-a", 0, 0, 0)]).firstPassRate).toBeUndefined();
  });

  it("sums counts across models and sorts the per-model list by count", () => {
    const result = memberPerformance([
      candidate("small", 2, 1, 1),
      candidate("large", 6, 5, 4, "claude"),
      candidate("unused", 0, 0, 0),
    ]);
    expect(result.reviewed).toBe(8);
    expect(result.firstPassRate).toBe(5 / 8);
    expect(result.acceptedRate).toBe(6 / 8);
    expect(result.perModel).toEqual([
      { model: "large", harness: "claude", count: 6, firstPassRate: 4 / 6 },
      { model: "small", harness: "codex", count: 2, firstPassRate: 1 / 2 },
    ]);
  });

  it("merges candidates that share a harness and model and keeps fractions unrounded", () => {
    const result = memberPerformance([candidate("same", 1, 1, 0), candidate("same", 2, 0, 1)]);
    expect(result.perModel).toEqual([
      { model: "same", harness: "codex", count: 3, firstPassRate: 1 / 3 },
    ]);
    expect(result.firstPassRate).toBe(1 / 3);
    expect(result.acceptedRate).toBe(1 / 3);
  });

  it("keeps a rate of zero when no first pass succeeded", () => {
    expect(memberPerformance([candidate("m", 4, 0, 0)])).toMatchObject({
      firstPassRate: 0,
      acceptedRate: 0,
    });
  });
});
