// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { AgentTranscript } from "./AgentTranscript";
import type { Block } from "../model/session";

it("keeps settled Markdown mounted without rendering on document visibility changes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const container = document.createElement("div");
  const root = createRoot(container);
  const onRender = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(
          Profiler,
          { id: "settled-markdown", onRender },
          createElement(AgentMarkdown, { text: "Saved **Markdown**" }),
        ),
      ),
    );
    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe("Saved Markdown");
    onRender.mockClear();

    for (const state of ["hidden", "visible"] as const) {
      visibility.mockReturnValue(state);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    }

    expect(onRender).not.toHaveBeenCalled();
    expect(container.querySelector("p")).toBe(paragraph);
  } finally {
    act(() => root.unmount());
    visibility.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("keeps completed markdown nodes and selection while the tail and block boundary change", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const render = (text: string) => act(() => root.render(createElement(AgentMarkdown, { text })));
    render("Completed **selectable** paragraph.\n\nTail");
    const paragraph = container.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    render("Completed **selectable** paragraph.\n\nTail grows");
    expect(container.querySelector("p")).toBe(paragraph);
    expect(document.getSelection()!.toString()).toBe("Completed selectable paragraph.");
    render("Completed **selectable** paragraph.\n\nTail grows\n\nNew paragraph");
    expect(container.querySelector("p")).toBe(paragraph);
    expect(document.getSelection()!.toString()).toBe("Completed selectable paragraph.");
    expect(container.textContent).toContain("Tail growsNew paragraph");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("updates a 5200-block conversation without remounting its completed visible answer", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const blocks: Block[] = Array.from({ length: 2600 }, (_, i) => [
    { id: `u-${i}`, role: "user" as const, text: `Question ${i}` },
    { id: `a-${i}`, role: "assistant" as const, text: `Answer ${i}` },
  ]).flat();
  try {
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: false })));
    const answer = [...container.querySelectorAll("p")].find(
      (el) => el.textContent === "Answer 2598",
    );
    expect(answer).toBeDefined();
    expect(container.querySelectorAll(".transcript-turn").length).toBeLessThan(100);
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: [
            ...blocks.slice(0, -1),
            { ...blocks.at(-1)!, text: "Answer 2599 with appended output" },
          ],
          busy: false,
        }),
      ),
    );
    expect(answer!.isConnected).toBe(true);
    expect(container.textContent).toContain("Answer 2599 with appended output");
    expect(container.textContent).not.toContain("Question 0");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
