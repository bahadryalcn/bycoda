import { createElement } from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";

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

  it("composer yokken giriş tezgahını ve ajan ekibini göstermez", () => {
    const markup = renderToStaticMarkup(createElement(EmptySession, { cwd: "/work/demo" }));
    expect(markup).not.toContain("bycoda-entry-workbench");
    expect(markup).not.toContain("crew-scene");
    expect(markup).not.toContain("<canvas");
  });
});
