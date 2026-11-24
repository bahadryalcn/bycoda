// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { HighlightResult } from "@streamdown/code";
import { HighlightedCodeBlock } from "./HighlightedCodeBlock";

const plugin = vi.hoisted(() => ({
  getThemes: () => ["github-light", "github-dark"],
  supportsLanguage: () => true,
  highlight: vi.fn(),
}));
vi.mock("../../files/public/useCodeHighlightPlugin", () => ({
  useCodeHighlightPlugin: () => plugin,
}));

it("commits once per text update, then again only when async highlighting changes output", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  let complete: (result: HighlightResult) => void = () => {};
  plugin.highlight.mockImplementation((_args, callback) => {
    complete = callback;
    return null;
  });
  const result = (text: string) =>
    ({ tokens: [[{ content: text }]] }) as unknown as HighlightResult;
  const commits = vi.fn();
  const render = (code: string) =>
    act(() =>
      root.render(
        createElement(
          Profiler,
          { id: "fence", onRender: commits },
          createElement(HighlightedCodeBlock, {
            code,
            language: "text",
            isIncomplete: false,
            lineNumbers: false,
          }),
        ),
      ),
    );
  try {
    render("first");
    expect(commits).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("first");
    act(() => complete(result("first")));
    commits.mockClear();
    render("first tail");
    expect(commits).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("first tail");
    act(() => complete(result("first tail")));
    expect(commits).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("first tail");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});

it("shows every streamed line when highlighting a later version fails", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  let complete: (result: HighlightResult) => void = () => {};
  plugin.highlight.mockImplementation((_args, callback) => {
    complete = callback;
    return null;
  });
  // What the highlighter reports on failure: the given code as untokenized lines.
  const plain = (code: string) =>
    ({ tokens: code.split("\n").map((content) => [{ content }]) }) as unknown as HighlightResult;
  const render = (code: string) =>
    act(() =>
      root.render(
        createElement(HighlightedCodeBlock, {
          code,
          language: "ts",
          isIncomplete: false,
          lineNumbers: false,
        }),
      ),
    );
  try {
    render("first");
    act(() => complete(plain("first")));
    render("first\nlater line");
    expect(container.textContent).toContain("later line");
    act(() => complete(plain("first\nlater line")));
    expect(container.textContent).toContain("later line");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});

it("shows each open fence update immediately and requests tokens once the fence closes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class {});
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (code: string, isIncomplete: boolean) =>
    act(() =>
      root.render(
        createElement(HighlightedCodeBlock, {
          code,
          language: "typescript",
          isIncomplete,
          lineNumbers: true,
          startLine: 9,
        }),
      ),
    );
  try {
    render("const value", true);
    render("const value = 1;\nreturn value;", true);
    expect(container.querySelector("code")?.textContent).toContain("return value;");
    expect(plugin.highlight.mock.calls.map(([options]) => options.code)).toEqual([""]);
    render("const value = 1;\nreturn value;", false);
    expect(plugin.highlight.mock.calls.map(([options]) => options.code)).toEqual([
      "",
      "const value = 1;\nreturn value;",
    ]);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});

it("keeps all code readable while a large token result is painted across frames", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const container = document.createElement("div");
  const root = createRoot(container);
  const tokens = Array.from({ length: 600 }, (_, i) => ({ content: String(i) + " " }));
  const source = tokens.map((token) => token.content).join("");
  plugin.highlight.mockReturnValue({ tokens: [tokens] });
  try {
    act(() =>
      root.render(
        createElement(HighlightedCodeBlock, {
          code: source,
          language: "typescript",
          isIncomplete: false,
          lineNumbers: true,
        }),
      ),
    );
    const line = container.querySelector("code")!;
    const colored = () => line.querySelectorAll(".markdown-code-token").length;
    expect(line.textContent).toBe(source);
    expect(colored()).toBeGreaterThan(0);
    expect(colored()).toBeLessThan(tokens.length);
    for (let i = 0; i < 10; i++) act(() => vi.advanceTimersByTime(16));
    expect(colored()).toBe(tokens.length);
    expect(line.textContent).toBe(source);
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});

it("preserves a native selection until the user releases it after highlighting finishes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let complete: (result: HighlightResult) => void = () => {};
  plugin.highlight.mockImplementation((_options, callback) => {
    complete = callback;
    return null;
  });
  try {
    act(() =>
      root.render(
        createElement(HighlightedCodeBlock, {
          code: "const ready = true;",
          language: "typescript",
          isIncomplete: false,
          lineNumbers: false,
        }),
      ),
    );
    const selection = document.getSelection()!;
    selection.selectAllChildren(container.querySelector("code > span")!);
    act(() => complete({ tokens: [[{ content: "const ready = true;", offset: 0 }]] }));
    expect(selection.toString()).toBe("const ready = true;");
    expect(container.querySelector(".markdown-code-token")).toBeNull();
    act(() => {
      selection.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(container.querySelector(".markdown-code-token")?.textContent).toBe(
      "const ready = true;",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});

it("lets an active editor paint between token batches and still finishes during continuous input", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const container = document.createElement("div");
  const editor = document.createElement("textarea");
  document.body.append(container, editor);
  const root = createRoot(container);
  const tokens = Array.from({ length: 1_200 }, (_, index) => ({ content: index + " " }));
  const source = tokens.map(({ content }) => content).join("");
  plugin.highlight.mockReturnValue({ tokens: [tokens] });
  const count = () => container.querySelectorAll(".markdown-code-token").length;
  const type = () => editor.dispatchEvent(new Event("input", { bubbles: true }));
  const render = (isIncomplete: boolean) =>
    act(() =>
      root.render(
        createElement(HighlightedCodeBlock, {
          code: source,
          language: "typescript",
          isIncomplete,
          lineNumbers: false,
        }),
      ),
    );
  try {
    render(true);
    type();
    render(false);
    act(() => vi.advanceTimersByTime(64));
    expect(count()).toBe(0);
    expect(container.querySelector("code")?.textContent).toBe(source);
    act(() => vi.advanceTimersByTime(160));
    const first = count();
    expect(first).toBeGreaterThan(0);
    type();
    act(() => vi.advanceTimersByTime(64));
    expect(count()).toBe(first);
    for (let i = 0; i < 100 && count() < tokens.length; i++) {
      type();
      act(() => vi.advanceTimersByTime(64));
    }
    expect(count()).toBe(tokens.length);
    expect(container.querySelector("code")?.textContent).toBe(source);
  } finally {
    act(() => root.unmount());
    editor.remove();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});
