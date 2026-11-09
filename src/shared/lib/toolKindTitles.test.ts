import { expect, it } from "vitest";
import { knownToolKindTitle } from "./toolKindTitles";
import { looksLikeCallId, pickOption } from "./records";

it("shares known titles and separates adapter fallback from subagent policies", () => {
  expect(knownToolKindTitle("search")).toBe("Find");
  expect(knownToolKindTitle("task")).toBeUndefined();
  expect(knownToolKindTitle("task", true)).toBe("Subagent");
  expect(knownToolKindTitle("custom-tool", true)).toBeUndefined();
  expect(knownToolKindTitle("constructor")).toBeUndefined();
});
it("preserves call id boundaries and adapter preference order", () => {
  expect(looksLikeCallId("  tool-abc_1  ")).toBe(true);
  expect(looksLikeCallId("12345678-abcd-abcd-abcd-123456789abc")).toBe(true);
  expect(looksLikeCallId("call")).toBe(false);
  expect(looksLikeCallId("ordinary prose")).toBe(false);
  expect(pickOption(["once", "always"], ["always", "once"])).toBe("always");
  expect(pickOption(["once"], ["deny"])).toBeNull();
});
