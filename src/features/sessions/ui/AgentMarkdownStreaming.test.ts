// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { AgentTranscript } from "./AgentTranscript";
import type { Block } from "../model/session";

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
    expect(container.textContent).toContain("Load earlier");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
