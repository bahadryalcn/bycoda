// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root as Root2 } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import type { Element, Root } from "hast";
import { revealEnd, rehypeWordFade, usePacedText, WORD_FADE_MS } from "./wordFade";
import { PresentationVisibility } from "./presentationVisibility";

describe("revealEnd", () => {
  it("stops at the end of the word the reveal has reached", () => {
    expect(revealEnd("Hello there friend", 0, true)).toBe(5);
    expect(revealEnd("Hello there friend", 6.2, true)).toBe(11);
    expect(revealEnd("Hello there", 5, true)).toBe(5);
  });

  it("holds a word still being streamed back until it is whole", () => {
    expect(revealEnd("Hello the", 7, true)).toBe(6);
    expect(revealEnd("Hel", 1, true)).toBe(0);
  });

  it("lets the last word out once the stream has ended", () => {
    expect(revealEnd("Hello the", 7, false)).toBe(9);
  });
});

describe("paced streaming", () => {
  let container: HTMLDivElement;
  let root: Root2;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const reply =
    "I will review the current diff and recent commits, then check the affected code for regressions.";

  function render(text: string, streaming: boolean) {
    act(() => root.render(createElement(AgentMarkdown, { text, streaming })));
  }

  function shown() {
    return container.textContent ?? "";
  }

  it("shares one reveal frame across replies and releases it when hidden or unmounted", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    function Reply() {
      return usePacedText(reply, true).text;
    }
    const replies = () => [0, 1, 2, 3].map((key) => createElement(Reply, { key }));
    act(() =>
      root.render(createElement(PresentationVisibility.Provider, { value: true }, replies())),
    );
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(16));
    expect(raf).toHaveBeenCalledTimes(2);
    act(() =>
      root.render(createElement(PresentationVisibility.Provider, { value: false }, replies())),
    );
    expect(shown()).toBe(reply.repeat(4));
    const calls = raf.mock.calls.length;
    act(() => vi.advanceTimersByTime(100));
    expect(raf).toHaveBeenCalledTimes(calls);
    act(() => root.render(null));
    act(() => root.render(createElement(Reply)));
    expect(raf).toHaveBeenCalledTimes(calls + 1);
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(100));
    expect(raf).toHaveBeenCalledTimes(calls + 1);
    raf.mockRestore();
  });

  it("paces the first streaming chunk on mount", () => {
    render(reply, true);
    expect(shown()).toBe("");
    act(() => vi.advanceTimersByTime(100));
    expect(shown().length).toBeGreaterThan(0);
    expect(shown().length).toBeLessThan(reply.length);
  });

  it("continues revealing while chunks arrive faster than one animation frame", () => {
    render("", true);
    let incoming = "";
    for (let index = 0; index < 40; index++) {
      incoming += "word ";
      render(incoming, true);
      act(() => vi.advanceTimersByTime(4));
    }
    expect(shown().length).toBeGreaterThan(0);
    expect(shown().length).toBeLessThan(incoming.trim().length);
  });

  it("paces a newly completed mount when explicitly requested", () => {
    act(() =>
      root.render(
        createElement(AgentMarkdown, { text: reply, streaming: false, revealOnMount: true }),
      ),
    );
    expect(shown()).toBe("");
    act(() => vi.advanceTimersByTime(2_000));
    expect(shown()).toBe(reply);
  });

  function fading() {
    return !!container.querySelector(".agent-markdown.word-fading");
  }

  function word(text: string) {
    return [...container.querySelectorAll("[data-word-fade]")].find(
      (span) => span.textContent === text,
    );
  }

  it("lets a burst out a word at a time rather than all at once", () => {
    render("", true);
    render(reply, true);
    expect(shown()).toBe("");
    expect(fading()).toBe(true);

    act(() => vi.advanceTimersByTime(100));
    const early = shown();
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(reply.length);
    expect(reply.startsWith(early)).toBe(true);
    expect(early.endsWith(" ")).toBe(false);

    act(() => vi.advanceTimersByTime(2_000));
    expect(shown()).toBe(reply);
  });

  it("gives a word still fading one element for as long as it fades", () => {
    render("", true);
    render("I will review ", true);
    act(() => vi.advanceTimersByTime(60));
    const first = word("I");
    expect(first).toBeDefined();

    // The fade plays as an element is added, so a word that keeps its element
    // as the reply grows is a word that does not fade again.
    render("I will review the diff and **recent** commits ", true);
    act(() => vi.advanceTimersByTime(60));
    expect(word("I")).toBe(first);

    act(() => vi.advanceTimersByTime(2_000));
    expect(shown()).toBe("I will review the diff and recent commits");
    render("I will review the diff and **recent** commits", false);
    act(() => vi.advanceTimersByTime(WORD_FADE_MS));
    expect(shown()).toBe("I will review the diff and recent commits");
    expect(fading()).toBe(false);
    // Words past their fade are plain text again.
    expect(word("I")).toBeUndefined();
  });

  it("holds back a word still being written until the stream pauses on it", () => {
    render("", true);
    render("Hello wor", true);
    act(() => vi.advanceTimersByTime(100));
    expect(shown()).toBe("Hello");

    act(() => vi.advanceTimersByTime(300));
    expect(shown()).toBe("Hello wor");
  });

  it("reveals a completed stream immediately and stops fading", () => {
    render("", true);
    render(reply, true);
    render(reply, false);
    expect(shown()).toBe(reply);

    act(() => vi.advanceTimersByTime(2_000));
    expect(shown()).toBe(reply);
    act(() => vi.advanceTimersByTime(WORD_FADE_MS));
    // A finished reply drops the class its fade rule needs, so hiding and
    // showing it cannot replay the fade; the few spans left are inert.
    expect(fading()).toBe(false);
    expect(container.querySelectorAll("[data-word-fade]").length).toBeLessThan(20);
    expect(shown()).toBe(reply);
  });

  it("shows a reply that never streamed whole, as plain text", () => {
    render(reply, false);
    expect(shown()).toBe(reply);
    expect(fading()).toBe(false);
    expect(container.querySelector("[data-word-fade]")).toBeNull();
  });

  it("leaves code and links whole", () => {
    render("", true);
    render("Run `npm test` and see [the docs](https://example.com) now ", true);
    act(() => vi.advanceTimersByTime(2_000));
    expect(container.querySelector("code [data-word-fade]")).toBeNull();
    expect(container.querySelector("a [data-word-fade]")).toBeNull();
    expect(word("now")).toBeDefined();
  });

  it("settles a former tail when a new markdown block arrives", () => {
    render("Hello there ", true);
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector("p [data-word-fade]")).not.toBeNull();
    render("Hello there \n\nNew tail ", true);
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("p")!.querySelector("[data-word-fade]")).toBeNull();
    expect(shown()).toBe("Hello thereNew tail");
  });
});

describe("rehypeWordFade", () => {
  const text = (value: string) => ({ type: "text" as const, value });
  const el = (tagName: string, ...children: Element["children"]): Element => ({
    type: "element",
    tagName,
    properties: {},
    children,
  });
  const run = (fresh?: number) => {
    const tree: Root = {
      type: "root",
      children: [
        el(
          "p",
          text("one two "),
          el("code", text("a b")),
          el("a", text("c d")),
          text(" three four"),
        ),
      ],
    };
    rehypeWordFade(fresh === undefined ? undefined : { freshWords: () => fresh })(tree);
    const p = tree.children[0] as Element;
    const wrapped = p.children.flatMap((c) =>
      c.type === "element" && "dataWordFade" in c.properties
        ? [(c.children[0] as { value: string }).value]
        : [],
    );
    return { p, wrapped };
  };

  it("wraps every word of prose when no window is given, and leaves code and links whole", () => {
    const { p, wrapped } = run();
    expect(wrapped).toEqual(["one", "two", "three", "four"]);
    const code = p.children.find((c) => c.type === "element" && c.tagName === "code") as Element;
    expect(code.children).toEqual([text("a b")]);
  });

  it("leaves words before the window as plain text and wraps only the new ones", () => {
    const { p, wrapped } = run(2);
    expect(wrapped).toEqual(["three", "four"]);
    expect(p.children[0]).toEqual(text("one two "));
  });

  it("wraps nothing once the message has settled", () => {
    expect(run(0).wrapped).toEqual([]);
  });

  it("keys a word by its place in the block, whichever words are in the window", () => {
    const tags = (fresh: number) =>
      run(fresh).p.children.flatMap((c) =>
        c.type === "element" && "dataWordFade" in c.properties ? [c.tagName] : [],
      );
    expect(tags(2)).toEqual(tags(3).slice(1));
  });
});

describe("streamed message DOM", () => {
  let container: HTMLDivElement;
  let root: Root2;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const paragraphs = (n: number) =>
    Array.from({ length: n }, (_, i) => `Paragraph ${i} ` + "word ".repeat(58).trim()).join("\n\n");

  it("bounds the spans of a long reply and does not remount at stream end", () => {
    const full = paragraphs(50);
    act(() => root.render(createElement(AgentMarkdown, { text: "", streaming: true })));
    for (let i = 0; i < full.length; i += 60) {
      const streamed = full.slice(0, i + 60);
      act(() => root.render(createElement(AgentMarkdown, { text: streamed, streaming: true })));
      act(() => vi.advanceTimersByTime(50));
    }
    act(() => vi.advanceTimersByTime(3_000));
    expect(container.textContent).toContain("Paragraph 49");
    const mid = container.querySelectorAll("[data-word-fade]").length;
    // A few words still fading, not the ~3,000 words of the message.
    expect(mid).toBeLessThan(600);

    const marker = container.querySelector("p");
    act(() => root.render(createElement(AgentMarkdown, { text: full, streaming: false })));
    act(() => vi.advanceTimersByTime(WORD_FADE_MS * 2));
    const settled = container.querySelectorAll("[data-word-fade]").length;
    expect(settled).toBeLessThan(600);
    expect(container.querySelector(".word-fading")).toBeNull();
    expect(container.querySelector("p")).toBe(marker);
  });
});
