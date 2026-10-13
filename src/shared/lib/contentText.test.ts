import { expect, it } from "vitest";
import { humanField, textFromContent } from "./contentText";
it("normal ve hazır whitespace chunk politikalarını ayrı tutar", () => {
  const content = [{ text: "a " }, { content: [{ text: "b" }, { text: "c" }] }];
  expect(textFromContent(content, " ")).toBe("a  b c");
  expect(textFromContent(content, " ", true)).toBe("a b c");
  expect(textFromContent(content)).toBe("a bc");
  expect(textFromContent([null, 3, {}, "x"])).toBe("x");
});
it("insan alanı call kimliğini reddeder, asıl whitespace'i korur", () => {
  expect(humanField({ name: "call-abc" }, "name")).toBeUndefined();
  expect(humanField({ name: " Read file " }, "name")).toBe(" Read file ");
});
