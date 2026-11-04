// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let host: HTMLDivElement;
let reveal: ((id: string) => boolean) | null;
let jump: (() => void) | null;
const conversation = (): Block[] =>
  Array.from({ length: 200 }, (_, index): Block[] => [
    { id: `u-${index}`, role: "user", text: `Question ${index}` },
    ...(index === 90
      ? [
          {
            id: "pending",
            role: "tool" as const,
            text: "echo approval",
            tool: { kind: "shell" as const, status: "pending" as const },
            approval: { requestId: 1 },
          },
        ]
      : []),
    { id: `a-${index}`, role: "assistant", text: `Answer ${index}` },
  ]).flat();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  reveal = null;
  jump = null;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(blocks: Block[]) {
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy: true,
        onApproval: vi.fn(),
        onRevealReady: (value) => {
          reveal = value;
        },
        onJumpToBottomReady: (value) => {
          jump = value;
        },
      }),
    ),
  );
}

it("keeps pending approval and live output mounted outside bounded historical window", () => {
  render(conversation());
  act(() => {
    expect(reveal?.("u-0")).toBe(true);
  });
  expect(host.querySelectorAll("[data-transcript-turn]")).toHaveLength(62);
  expect(host.querySelector('[data-transcript-turn="u-0"]')).not.toBeNull();
  expect(host.querySelector('[data-transcript-turn="u-90"]')?.textContent).toContain("Allow");
  expect(host.querySelector('[data-transcript-turn="u-199"]')).not.toBeNull();
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Load newer messages"),
    ),
  ).toBe(true);
  act(() => jump?.());
  expect(host.querySelector('[data-transcript-turn="u-0"]')).toBeNull();
  expect(host.querySelector('[data-transcript-turn="u-199"]')).not.toBeNull();
  // Twenty tail turns plus the still unresolved original approval, never a hidden permission action.
  expect(host.querySelectorAll("[data-transcript-turn]")).toHaveLength(21);
});

it("retains a reader's selected historical DOM while latest output arrives", () => {
  const blocks = conversation();
  render(blocks);
  act(() => reveal?.("u-0"));
  const original = host.querySelector<HTMLElement>('[data-transcript-turn="u-0"]')!;
  const range = document.createRange();
  range.selectNodeContents(original);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  render([
    ...blocks,
    { id: "u-200", role: "user", text: "Next question" },
    { id: "a-200", role: "assistant", text: "Streaming" },
  ]);
  expect(host.querySelector('[data-transcript-turn="u-0"]')).toBe(original);
  expect(selection.toString()).toContain("Question 0");
  expect(original.querySelector('[aria-label="Copy message"]')).not.toBeNull();
  expect(host.querySelector('[data-transcript-turn="u-200"]')).not.toBeNull();
  selection.removeAllRanges();
});
