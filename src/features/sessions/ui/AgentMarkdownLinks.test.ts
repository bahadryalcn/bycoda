// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock("../../../platform/tauri/openExternal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/openExternal")>()),
  openExternal,
}));

describe("markdown mailto and in-message anchors", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    openExternal.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(texts: string[]) {
    await act(async () =>
      root.render(texts.map((text, key) => createElement(AgentMarkdown, { key, text }))),
    );
  }

  it("opens an autolinked email address with the mail client", async () => {
    await render(["Write to me@example.com today."]);
    const link = container.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
    await act(async () => link.click());
    expect(openExternal).toHaveBeenCalledWith("mailto:me@example.com");
  });

  it("scrolls a footnote link to the footnote in its own message", async () => {
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    // Both replies number their footnote 1, so their target ids collide.
    await render([
      "First claim[^1]\n\n[^1]: First source\n",
      "Second claim[^1]\n\n[^1]: Second source\n",
    ]);
    const messages = container.querySelectorAll(".agent-markdown");
    const reference = messages[1].querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
    await act(async () => reference.click());
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].textContent).toContain("Second source");
    expect(openExternal).not.toHaveBeenCalled();
  });
});
