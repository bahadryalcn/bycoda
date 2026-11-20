import { createElement } from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";

describe("empty session heading", () => {
  it("shows the project path as visible text, not only on hover", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { cwd: "/work/demo", composer: createElement("textarea") }),
    );

    expect(markup).toContain('<p class="bycoda-task-path">/work/demo</p>');
  });

  it("distinguishes projects that share the same folder name", () => {
    for (const cwd of ["/work/client-a/demo", "/work/client-b/demo"]) {
      const markup = renderToStaticMarkup(
        createElement(EmptySession, { cwd, composer: createElement("textarea") }),
      );

      expect(markup).toMatch(/<h2[^>]*>demo<\/h2>/);
      expect(markup).toContain(`<p class="bycoda-task-path">${cwd}</p>`);
    }
  });

  it("names the wordmark with a role assistive technology reads", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { cwd: "/work/demo", composer: createElement("textarea") }),
    );

    expect(markup).toContain(`role="img" aria-label="${PRODUCT_IDENTITY.displayName}"`);
  });
});

describe("empty session background", () => {
  it("renders the lazy crew when no chat background is selected", async () => {
    const stream = await renderToReadableStream(
      createElement(EmptySession, { cwd: "/work/demo", composer: createElement("textarea") }),
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("<canvas");
    expect(markup).toContain("crew-scene");
  });

  it("does not render the crew over a selected chat background", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        composer: createElement("textarea"),
        hasChatBackground: true,
      }),
    );

    expect(markup).not.toContain("<canvas");
  });

  it("does not show the entry bench or the agent crew without a composer", () => {
    const markup = renderToStaticMarkup(createElement(EmptySession, { cwd: "/work/demo" }));
    expect(markup).not.toContain("bycoda-entry-workbench");
    expect(markup).not.toContain("crew-scene");
    expect(markup).not.toContain("<canvas");
  });
});
