import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LoadingText } from "./LoadingText";

it("renders the same pending glyph and one status for every inline wait", () => {
  const html = renderToStaticMarkup(
    createElement(LoadingText, { delay: false, className: "status-note" }, "Still loading"),
  );
  expect(html).toContain('role="status"');
  expect(html).toContain('data-size="xs"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("Still loading");
  expect(html.match(/role="status"/g)).toHaveLength(1);
});

it("renders nothing inline, and an unannounced box when filling, until the delay has passed", () => {
  expect(renderToStaticMarkup(createElement(LoadingText, null, "Loading branches…"))).toBe("");
  const fill = renderToStaticMarkup(createElement(LoadingText, { layout: "fill" }, "Loading…"));
  expect(fill).toContain('aria-hidden="true"');
  expect(fill).not.toContain('role="status"');
});

it("keeps loading feedback valid inside prose and announces it once", () => {
  const html = renderToStaticMarkup(
    createElement(
      "p",
      null,
      createElement(LoadingText, { as: "span", delay: false }, "Loading image…"),
    ),
  );
  expect(html).toContain('<p><span role="status"');
  expect(html).not.toContain("<div");
  expect(html.match(/role="status"/g)).toHaveLength(1);
});
