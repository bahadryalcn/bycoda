import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./ScrollArea";

describe("ScrollArea", () => {
  it("keeps the default host and attributes", () => {
    const html = renderToStaticMarkup(createElement(ScrollArea, null));
    expect(html).toMatch(/^<div data-axis="y" class="[^"]+"><\/div>$/);
  });

  it("preserves list semantics and configures forced horizontal scrolling", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollArea, { as: "ul", axis: "both", scrollbar: "always", gutter: "stable" }),
    );
    expect(html).toContain('<ul data-axis="both" data-scrollbar="always" data-gutter="stable"');
  });
});
