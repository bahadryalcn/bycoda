import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HarnessIcon, MONOCHROME_HARNESSES } from "./HarnessIcon";

// An <img> cannot inherit currentColor, so every single-colour mark must render inline or masked
// to stay visible on dark grounds.
it.each([...MONOCHROME_HARNESSES])(
  "renders %s without an img so it follows the text colour",
  (harness) => {
    const html = renderToStaticMarkup(createElement(HarnessIcon, { harness, size: "md" }));
    expect(html).not.toContain("<img");
  },
);
