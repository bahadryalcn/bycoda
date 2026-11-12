import { expect, it, vi } from "vitest";
import type { Element, ElementContent, Root } from "hast";
import { MAX_FADING_WORDS, rehypeWordFade, type WordFadeOptions } from "./wordFade";

// Pre-optimization transform, retained as the DOM/animation oracle.
function oracle(tree: Root, options: WordFadeOptions) {
  const unfaded = new Set(["a", "code", "pre", "svg", "math", "kbd"]);
  const space = (code: number) => [32, 10, 9, 13].includes(code);
  function count(parent: Root | Element): number {
    let total = 0;
    for (const child of parent.children) {
      if (child.type === "text") total += (child.value.match(/[^ \n\t\r]+/g) ?? []).length;
      else if (child.type === "element" && !unfaded.has(child.tagName)) total += count(child);
    }
    return total;
  }
  const total = count(tree);
  const first = options.freshWords ? total - Math.min(options.freshWords(), MAX_FADING_WORDS) : -1;
  let seen = 0;
  function wrap(value: string): ElementContent[] {
    const out: ElementContent[] = [];
    let plain = "";
    for (const part of value.split(/(\s+)/)) {
      if (!part) continue;
      if (space(part.charCodeAt(0)) || seen++ < first) {
        plain += part;
        continue;
      }
      if (plain) out.push({ type: "text", value: plain });
      plain = "";
      out.push({
        type: "element",
        tagName: `fade-w${seen}`,
        properties: {
          dataWordFade: "",
          ...(options.wordStyle ? { style: options.wordStyle(total - seen) } : {}),
        },
        children: [{ type: "text", value: part }],
      });
    }
    if (plain) out.push({ type: "text", value: plain });
    return out;
  }
  function walk(parent: Root | Element) {
    const children: Root["children"] = [];
    for (const child of parent.children) {
      if (child.type === "text") children.push(...wrap(child.value));
      else {
        if (child.type === "element" && !unfaded.has(child.tagName)) walk(child);
        children.push(child);
      }
    }
    parent.children = children as typeof parent.children;
  }
  walk(tree);
}

const tree = (text: string): Root => ({
  type: "root",
  children: [
    { type: "text", value: "first " },
    { type: "element", tagName: "em", properties: {}, children: [{ type: "text", value: text }] },
    {
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value: "unfaded code" }],
    },
  ],
});

it("keeps byte-identical text nodes, fade tags and duration styles", () => {
  let fresh = 0;
  const options = {
    freshWords: () => fresh,
    wordStyle: (fromEnd: number) => `animation-duration:${80 + fromEnd}ms`,
  };
  const transform = rehypeWordFade(options);
  for (const text of [
    "hi",
    "hi there",
    "hi there\n",
    "hi there\n\u00a0",
    "hi there\n\u00a0 \tmore",
    "replacement",
    "",
    "🙂 e\u0301",
  ]) {
    for (fresh of [0, 1, 3, 6, 100]) {
      const actual = tree(text);
      const expected = tree(text);
      oracle(expected, options);
      transform(actual);
      expect(actual).toEqual(expected);
    }
  }
});

it("does not split the settled prefix again on an appended delta", () => {
  const transform = rehypeWordFade({ freshWords: () => 2 });
  const text = "settled ".repeat(10000) + "unfinished";
  transform(tree(text));
  const split = vi.spyOn(String.prototype, "split");
  try {
    transform(tree(text + " tail"));
    expect(split.mock.contexts.map(String)).toEqual([" tail"]);
  } finally {
    split.mockRestore();
  }
});
