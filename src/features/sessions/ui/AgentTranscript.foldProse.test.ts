// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { REVEAL_MAX_LAG_MS } from "./wordFade";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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

function tool(id: string): Block {
  return {
    id,
    role: "tool",
    text: `Inspect ${id}`,
    tool: { kind: "shell", status: "completed" },
  };
}

describe("assistant messages remain visible around folded work", () => {
  it.each([true, false])("keeps every message visible with collapsed tools (busy=%s)", (busy) => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Keep me posted" },
      tool("t1"),
      { id: "note", role: "assistant", text: "Trying the other config." },
      tool("t2"),
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy })));

    expect(container.textContent).toContain("Trying the other config.");
    expect(container.textContent).toContain("The investigation is complete.");
    expect(container.querySelector(".zen-fold-prose")).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show the work"]',
    )!;
    expect(toggle).not.toBeNull();

    act(() => toggle.click());

    expect(container.querySelectorAll(".zen-fold-prose")).toHaveLength(0);
    expect(container.textContent?.match(/Trying the other config\./g)).toHaveLength(1);
    expect(container.textContent).toContain("Inspect t1");
    expect(container.textContent).toContain("Inspect t2");
    act(() => toggle.click());
    expect(container.textContent).toContain("Trying the other config.");

    // The answer renders the same markdown root, outside the demoted wrapper.
    const answer = Array.from(container.querySelectorAll(".agent-markdown")).find((el) =>
      el.textContent?.includes("The investigation is complete."),
    );
    expect(answer).not.toBeUndefined();
    expect(answer?.closest(".zen-fold-prose")).toBeNull();
  });

  it("retains earlier updates when more Codex messages and tools arrive", () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    const user: Block = {
      id: "u",
      role: "user",
      text: "Fix the missing messages",
    };
    const first: Block = {
      id: "a1",
      role: "assistant",
      text: "Inspecting session history.",
    };
    const second: Block = {
      id: "a2",
      role: "assistant",
      text: "Found the cause. Checking the fix.",
    };
    const final: Block = {
      id: "a3",
      role: "assistant",
      text: "The fix is verified.",
    };
    for (const [blocks, busy] of [
      [[user, first, tool("t1")], true],
      [[user, first, tool("t1"), second, tool("t2")], true],
      [[user, first, tool("t1"), second, tool("t2"), final], false],
    ] as [Block[], boolean][]) {
      act(() => root.render(createElement(AgentTranscript, { blocks, busy, harness: "codex" })));
      // Newly arriving prose reveals at a bounded pace. This test checks
      // retention and fold placement once the reveal has reached its text.
      act(() => vi.advanceTimersByTime(REVEAL_MAX_LAG_MS + 32));
      const texts = Array.from(
        container.querySelectorAll(".agent-markdown"),
        (el) => el.textContent,
      );
      expect(texts).toContain(first.text);
      if (blocks.includes(second)) expect(texts).toContain(second.text);
      if (blocks.includes(final)) expect(texts).toContain(final.text);
      expect(texts.indexOf(first.text)).toBeLessThan(
        texts.indexOf(second.text) < 0 ? texts.length : texts.indexOf(second.text),
      );
    }
  });
});
