import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ExternalEditorIcon } from "./ExternalEditorIcon";

it("draws the Cursor mark as an inline glyph so it follows the text colour", () => {
  const html = renderToStaticMarkup(createElement(ExternalEditorIcon, { id: "cursor" }));
  expect(html).not.toContain("<img");
  expect(html).toContain('fill="currentColor"');
});
