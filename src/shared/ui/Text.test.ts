import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Text, optionalTextAttributes, textAttributes } from "./Text";

it("keeps long diagnostic prose readable through an explicit shared wrapping role", () => {
  const content = "Bağlantı kurulamadı: Aleksandra Wiśniewska-Kowalczyk / çalışma-alanı/تجربة/👩🏽‍💻";
  const html = renderToStaticMarkup(createElement(Text, { wrap: "anywhere" }, content));
  expect(html).toContain('data-wrap="anywhere"');
  expect(html).not.toContain(' wrap="anywhere"');
  expect(html).toContain(content);
  expect(textAttributes({ wrap: "normal" })["data-wrap"]).toBe("normal");
  expect(optionalTextAttributes({ wrap: "anywhere" })).toMatchObject({ "data-wrap": "anywhere" });
  expect(optionalTextAttributes({})).toEqual({ className: undefined });
});
