// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useMarkdownRenderBlocks } from "./useMarkdownRenderBlocks";

it("renders large documents in batches, keeps selected nodes, and cancels obsolete work", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Probe({ blocks, stream }: { blocks: string[]; stream: string }) {
    const rendered = useMarkdownRenderBlocks(blocks, stream);
    return createElement(
      "div",
      { "data-pending": rendered.pending },
      rendered.blocks.map((text, index) => createElement("p", { key: index }, text)),
    );
  }
  const blocks = Array.from({ length: 150 }, (_, index) => `Paragraph ${index}`);
  try {
    act(() => root.render(createElement(Probe, { blocks, stream: "first" })));
    expect(container.querySelectorAll("p")).toHaveLength(64);
    const first = container.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(first);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    act(() => vi.advanceTimersByTime(16));
    expect(container.querySelectorAll("p")).toHaveLength(128);
    expect(container.querySelector("p")).toBe(first);
    expect(document.getSelection()!.toString()).toBe("Paragraph 0");
    act(() => vi.advanceTimersByTime(16));
    expect(container.querySelectorAll("p")).toHaveLength(150);
    expect(container.firstElementChild?.getAttribute("data-pending")).toBe("false");

    act(() => root.render(createElement(Probe, { blocks, stream: "replacement" })));
    expect(container.querySelectorAll("p")).toHaveLength(64);
    act(() => root.render(createElement(Probe, { blocks: ["New document"], stream: "short" })));
    act(() => vi.advanceTimersByTime(100));
    expect(container.textContent).toBe("New document");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
