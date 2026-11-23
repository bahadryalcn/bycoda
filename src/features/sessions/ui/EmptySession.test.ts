import { createElement } from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { adoptRemoteMachineInventory } from "../../connections/model/connections";
import { projectlessMachineProject } from "../../connections/model/sessionMachineTarget";

describe("empty session heading", () => {
  afterEach(() => adoptRemoteMachineInventory([]));

  it.each(["~", projectlessMachineProject("remote-host").key])(
    "leaves project selection to the composer and workbench for %s",
    (cwd) => {
      const markup = renderToStaticMarkup(
        createElement(EmptySession, { cwd, composer: createElement("textarea") }),
      );

      expect(markup).toContain("<textarea");
      expect(markup).not.toContain("Open a project");
      expect(markup).not.toContain("bycoda-task-brief");
    },
  );

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

  it("shows the saved machine name and folder path for a remote project", () => {
    adoptRemoteMachineInventory([
      {
        id: "saved-machine",
        name: "Office Mac",
        endpoint: "http://office.local",
        environmentId: "host-id",
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "remote://host-id/Users/user/projects/demo",
        composer: createElement("textarea"),
      }),
    );

    expect(markup).toContain("Office Mac · /Users/user/projects/demo");
    expect(markup).not.toContain("remote://host-id");
  });

  it("uses a generic machine label until the saved name is available", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "remote://host-id/C:/projects/demo",
        composer: createElement("textarea"),
      }),
    );

    expect(markup).toContain("Remote computer · C:/projects/demo");
    expect(markup).not.toContain("remote://host-id");
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
