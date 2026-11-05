import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionLabel } from "./SectionLabel";

describe("SectionLabel", () => {
  it("renders a standalone menu caption without extra wrappers", () => {
    const markup = renderToStaticMarkup(<SectionLabel variant="menu">Projects</SectionLabel>);
    expect(markup).toBe(
      '<div class="px-2 pb-0.5 pt-2 text-ui-caption font-medium text-(--ui-text-secondary)">Projects</div>',
    );
  });
});
