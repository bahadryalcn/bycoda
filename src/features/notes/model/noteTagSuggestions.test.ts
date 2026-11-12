import { expect, it } from "vitest";
import { noteTagSuggestions } from "./noteTagSuggestions";

it("offers existing tags first, normalizes duplicates and omits assigned tags", () => {
  expect(noteTagSuggestions(["#CUSTOM", "Custom", "Other tag", "Todo", ""], ["todo"])).toEqual([
    "custom",
    "other-tag",
    "idea",
    "plan",
    "in-progress",
    "done",
  ]);
});

it("keeps tags beyond the per-note assignment limit available", () => {
  const available = Array.from({ length: 30 }, (_, index) => `tag-${index}`);
  expect(noteTagSuggestions(available, [])).toContain("tag-29");
});
