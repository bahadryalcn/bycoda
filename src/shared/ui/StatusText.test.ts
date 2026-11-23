import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StatusText, type StatusTextTone } from "./StatusText";

it("renders an icon and the word in the tone, with no pill", () => {
  const tones: StatusTextTone[] = ["running", "needs-you", "failed", "done", "idle"];
  for (const tone of tones) {
    const html = renderToStaticMarkup(createElement(StatusText, { tone, children: "Word" }));
    expect(html).toContain(`data-status="${tone}"`);
    expect(html).toContain("Word");
    expect(html).toContain('aria-hidden="true"');
  }
});

it("lets a domain icon replace the tone icon", () => {
  const html = renderToStaticMarkup(
    createElement(StatusText, {
      tone: "idle",
      icon: createElement("i", { id: "own" }),
      children: "Idle",
    }),
  );
  expect(html).toContain('id="own"');
});
