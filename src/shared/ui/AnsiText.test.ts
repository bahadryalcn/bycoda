// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnsiText } from "./AnsiText";

let container: HTMLPreElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("pre");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
});

/** Node identity, not structure: `toEqual` would call two different text nodes equal. */
function expectSameNodes(actual: Text[], expected: Text[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((node, index) => expect(node === expected[index]).toBe(true));
}
function render(text: string) {
  act(() => root.render(createElement(AnsiText, { text })));
}
/** Every text node of the output, in reading order. */
function textNodes(): Text[] {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) nodes.push(node as Text);
  return nodes;
}

it("appends streamed plain output to the same text node so a selection in it survives", () => {
  render("row-000 first\nrow-001 second");
  const [node] = textNodes();
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 7);
  const append = vi.spyOn(Text.prototype, "appendData");
  render("row-000 first\nrow-001 second\nrow-002 third");
  // Browsers collapse a selection inside a text node whose whole value is replaced.
  expect(append.mock.calls).toEqual([["\nrow-002 third"]]);
  expect(container.textContent).toBe("row-000 first\nrow-001 second\nrow-002 third");
  expectSameNodes(textNodes(), [node]);
  expect(range.toString()).toBe("row-000");
});

it("keeps the retained tail's text node when the head is dropped and output is appended", () => {
  render("aaaa\nbbbb\ncccc");
  const [node] = textNodes();
  const remove = vi.spyOn(Text.prototype, "deleteData");
  const append = vi.spyOn(Text.prototype, "appendData");
  render("bbbb\ncccc\ndddd");
  expect(remove.mock.calls).toEqual([[0, 5]]);
  expect(append.mock.calls).toEqual([["\ndddd"]]);
  expect(container.textContent).toBe("bbbb\ncccc\ndddd");
  expectSameNodes(textNodes(), [node]);
});

it("replaces unrelated text and clears it", () => {
  render("one two");
  render("three");
  expect(container.textContent).toBe("three");
  render("");
  expect(container.textContent).toBe("");
  render("again");
  expect(container.textContent).toBe("again");
});

it("keeps every run's text node and color while the last colored run grows", () => {
  render("head \u001b[32mok\u001b[0m tail");
  const before = textNodes();
  render("head \u001b[32mok\u001b[0m tail more\nnext");
  expect(container.textContent).toBe("head ok tail more\nnext");
  expectSameNodes(textNodes().slice(0, before.length), before);
  expect(container.querySelector('span[class*="success"]')?.textContent).toBe("ok");
});

it("renders the first paint synchronously, hides escapes and supports concurrent runs", () => {
  render("a\u001b[31mred\u001b[0m\u001b]0;title\u0007b");
  expect(container.textContent).toBe("aredb");
});

it.each([
  ["abc", "abcdef"],
  ["abcdef", "abc"],
  ["abcdefghijkl", "defghijklmnop"],
  ["abcdefghijkl", "ijkl"],
  ["line\nline\nline\nline\nline", "line\nline\nline\nline\nline\nline"],
  ["\n", "\n\n"],
  ["same", "same"],
  ["abcdefgh", "zzabcdefgh"],
])("always renders the exact text: %j to %j", (before, after) => {
  render(before);
  render(after);
  expect(container.textContent).toBe(after);
});
