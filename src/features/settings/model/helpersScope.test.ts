import { expect, it } from "vitest";
import { helperEdits, helperKeys, pendingHelperEdits, withHelperEdits } from "./helpersScope";

it("keeps only helper keys", () => {
  expect(helperKeys({ crossAdvisor: "a", fast: "true" })).toEqual({ crossAdvisor: "a" });
  expect(pendingHelperEdits({ crossSubagents: null, effort: "low" })).toEqual({
    crossSubagents: null,
  });
});

it("overlays edits and records only what changed", () => {
  const stored = { crossAdvisor: "a", crossSubagents: "auto" };
  expect(withHelperEdits(stored, { crossAdvisor: null, imageModels: "[]" })).toEqual({
    crossSubagents: "auto",
    imageModels: "[]",
  });
  expect(helperEdits(stored, { crossAdvisor: "a", crossSubagents: "auto" })).toBeUndefined();
  expect(helperEdits(stored, { crossSubagents: "[]", fast: "true" })).toEqual({
    crossAdvisor: null,
    crossSubagents: "[]",
  });
});
