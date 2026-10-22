import { expect, it } from "vitest";
import { trimAndCapText } from "./cappedText";
it("boş string, trim, tam sınır ve ellipsis politikasını korur", () => {
  expect(trimAndCapText("  ", 8000)).toBe("");
  expect(trimAndCapText(" x ", 8000)).toBe("x");
  expect(trimAndCapText("a".repeat(8000), 8000)).toBe("a".repeat(8000));
  expect(trimAndCapText("a".repeat(8001), 8000)).toBe("a".repeat(8000) + "\n…");
});
