// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MiddleTruncate, splitMiddle } from "./MiddleTruncate";

it("keeps the file name or branch tail and leaves short values untouched", () => {
  expect(splitMiddle("src/features/files/ui/FileTree.test.tsx")).toEqual({
    head: "src/features/files/ui",
    tail: "/FileTree.test.tsx",
  });
  expect(splitMiddle("C:\\Users\\dev\\Projects\\monocode\\README.md")).toEqual({
    head: "C:\\Users\\dev\\Projects\\monocode",
    tail: "\\README.md",
  });
  expect(splitMiddle("feature/PROJ-123-add-login-redirect")).toEqual({
    head: "feature",
    tail: "/PROJ-123-add-login-redirect",
  });
  expect(splitMiddle("claude-opus-4-1-20250805")).toEqual({
    head: "claude-opus-4-",
    tail: "1-20250805",
  });
  expect(splitMiddle("main")).toEqual({ head: "main", tail: "" });
  expect(splitMiddle("/")).toEqual({ head: "/", tail: "" });
  expect(splitMiddle("a/b", { tail: 0 })).toEqual({ head: "a/b", tail: "" });
});

it("handles trailing separators, oversized segments and explicit tails", () => {
  expect(splitMiddle("packages/application/src/components/")).toEqual({
    head: "packages/application/src",
    tail: "/components/",
  });
  const long = `dir/${"x".repeat(60)}.tsx`;
  const split = splitMiddle(long);
  expect(split.tail).toHaveLength(28);
  expect(split.head + split.tail).toBe(long);
  expect(splitMiddle("very-long-component-name.test.tsx", { mode: "text", tail: 9 })).toEqual({
    head: "very-long-component-name",
    tail: ".test.tsx",
  });
  expect(splitMiddle("abcdef", { tail: Number.NaN })).toEqual({ head: "abcdef", tail: "" });
});

it("never splits surrogate pairs or emoji sequences", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  const value = `${"a".repeat(30)}${family}${family}`;
  const split = splitMiddle(value, { mode: "text", tail: 2 });
  expect(split.tail).toBe(`${family}${family}`);
  expect(split.head).toBe("a".repeat(30));
  const astral = `${"x".repeat(20)}\u{1F600}\u{1F600}\u{1F600}`;
  const emoji = splitMiddle(astral, { mode: "text", tail: 3 });
  expect(emoji.tail).toBe("\u{1F600}\u{1F600}\u{1F600}");
  expect(emoji.head + emoji.tail).toBe(astral);
});

it("exposes the exact value to assistive technology and tooltips, with decorative halves", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const path = "src/features/source-control/ui/GitChangesPanel.tsx";
  try {
    await act(async () => root.render(createElement(MiddleTruncate, { className: "x" }, path)));
    const node = host.firstElementChild as HTMLElement;
    expect(node.title).toBe(path);
    expect(node.classList.contains("x")).toBe(true);
    const [full, head, tail] = Array.from(node.children) as HTMLElement[];
    expect(full.textContent).toBe(path);
    expect(full.hasAttribute("aria-hidden")).toBe(false);
    expect(head.getAttribute("aria-hidden")).toBe("true");
    expect(tail.getAttribute("aria-hidden")).toBe("true");
    expect(head.textContent! + tail.textContent!).toBe(path);
    expect(tail.textContent).toBe("/GitChangesPanel.tsx");

    await act(async () => root.render(createElement(MiddleTruncate, { title: false }, "main")));
    const plain = host.firstElementChild as HTMLElement;
    expect(plain.hasAttribute("title")).toBe(false);
    expect(plain.children).toHaveLength(0);
    expect(plain.textContent).toBe("main");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
