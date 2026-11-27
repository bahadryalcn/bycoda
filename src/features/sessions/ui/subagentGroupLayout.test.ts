import { expect, it } from "vitest";
import { subagentGroupLayout, subagentGroupProgress } from "./subagentGroupLayout";

it("keeps one run as a row, shows two or three as cards and more as rows", () => {
  expect(subagentGroupLayout(1)).toBe("row");
  expect([2, 3].map(subagentGroupLayout)).toEqual(["cards", "cards"]);
  expect([4, 6, 12].map(subagentGroupLayout)).toEqual(["list", "list", "list"]);
});

it("counts finished and failed runs for the header", () => {
  expect(
    subagentGroupProgress(["done", "running", "failed", "done", "stopped", "running"]),
  ).toEqual({ done: 2, failed: 1, total: 6 });
  expect(subagentGroupProgress([])).toEqual({ done: 0, failed: 0, total: 0 });
});
