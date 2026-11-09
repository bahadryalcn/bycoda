import { describe, expect, it } from "vitest";
import { ALL_STAGES, stageTone, visibleTags } from "./audienceModel";

describe("stageTone", () => {
  it("maps each stage to its badge tone", () => {
    expect(ALL_STAGES.map((stage) => [stage, stageTone(stage)])).toEqual([
      ["new", "neutral"],
      ["contacted", "info"],
      ["replied", "accent"],
      ["interested", "warning"],
      ["customer", "success"],
      ["closed", "neutral"],
      ["opted_out", "danger"],
    ]);
  });
});

describe("visibleTags", () => {
  it("shows everything when it fits", () => {
    expect(visibleTags(["a", "b"])).toEqual({ shown: ["a", "b"], hidden: 0 });
    expect(visibleTags([])).toEqual({ shown: [], hidden: 0 });
  });

  it("folds the rest into a count", () => {
    expect(visibleTags(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b"], hidden: 3 });
    expect(visibleTags(["a", "b", "c"], 1)).toEqual({ shown: ["a"], hidden: 2 });
  });
});
