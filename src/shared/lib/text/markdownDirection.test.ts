import { expect, it } from "vitest";
import { detectMarkdownDirection } from "./markdownDirection";

it.each([
  ["Merhaba dünya, مرحبا بالعالم ve 日本語のテキスト, plus مرحبا again مرحبا مرحبا مرحبا", "ltr"],
  ["مرحبا بالعالم hello world and more english words here", "rtl"],
  ["## **שלום** world", "rtl"],
  ["- `code` 123 Hello مرحبا", "ltr"],
  ["12345 ... مرحبا", "rtl"],
  ["1234", "ltr"],
  ["", "ltr"],
] as const)("first strong letter decides: %s", (text, direction) => {
  expect(detectMarkdownDirection(text)).toBe(direction);
});
