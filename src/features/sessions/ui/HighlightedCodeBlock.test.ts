// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { HighlightResult } from "@streamdown/code";
import { HighlightedCodeBlock } from "./HighlightedCodeBlock";

const plugin = vi.hoisted(() => ({
  getThemes: () => ["github-light", "github-dark"],
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
            isIncomplete: true,
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
    expect(container.textContent).not.toContain("tail");
    act(() => complete(result("first tail")));
    expect(commits).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("first tail");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    plugin.highlight.mockReset();
  }
});
