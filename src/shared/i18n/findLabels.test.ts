import { describe, expect, it } from "vitest";
import { findControlLabels } from "./findLabels";

describe("findControlLabels", () => {
  it("gives every find surface the same sentence-case English labels", () => {
    expect(findControlLabels((message) => message)).toEqual({
      matchCase: "Match case",
      matchWholeWord: "Match whole word",
      useRegex: "Use regular expression",
      toggleReplace: "Toggle replace",
      previousMatch: "Previous match",
      nextMatch: "Next match",
    });
  });
});
