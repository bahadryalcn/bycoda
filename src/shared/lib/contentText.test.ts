import { expect, it } from "vitest";
import { humanField, textFromContent } from "./contentText";
it("keeps normal and preformatted whitespace chunk policies separate", () => {
  const content = [{ text: "a " }, { content: [{ text: "b" }, { text: "c" }] }];
  expect(textFromContent(content, " ")).toBe("a  b c");
  expect(textFromContent(content, " ", true)).toBe("a b c");
  expect(textFromContent(content)).toBe("a bc");
  expect(textFromContent([null, 3, {}, "x"])).toBe("x");
});
it("rejects a human-field call id and preserves the actual whitespace", () => {
  expect(humanField({ name: "call-abc" }, "name")).toBeUndefined();
  expect(humanField({ name: " Read file " }, "name")).toBe(" Read file ");
});
