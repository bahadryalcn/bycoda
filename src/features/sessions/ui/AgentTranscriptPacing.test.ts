// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
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
    text: `Run ${id}`,
    tool: { kind: "shell", status: "in_progress" },
  };
}

function render(blocks: Block[]) {
  act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));
}

function stages() {
  return [...container.querySelectorAll(".zen-phase-step")].map((step) =>
    step.hasAttribute("data-waiting")
      ? "waiting"
      : step.hasAttribute("data-entering")
        ? "entering"
        : "settled",
  );
}

it("paces a newly arrived reply completed before its first paint", () => {
  const head: Block[] = [{ id: "user", role: "user", text: "Explain" }];
  render(head);
  const reply = "A newly completed answer with enough words for a bounded reveal.";
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [...head, { id: "reply", role: "assistant", text: reply }],
        busy: false,
      }),
    ),
  );
  expect(container.querySelector(".agent-markdown")?.textContent).toBe("");
  act(() => vi.advanceTimersByTime(2_000));
  expect(container.querySelector(".agent-markdown")?.textContent).toBe(reply);
});

it("shows saved and newly reopened output immediately", () => {
  const head: Block[] = [{ id: "user", role: "user", text: "Explain" }];
  const reply: Block = { id: "reply", role: "assistant", text: "An already saved answer." };
  render([...head, reply]);
  expect(container.querySelector(".agent-markdown")?.textContent).toBe(reply.text);
  act(() => root.render(createElement(AgentTranscript, { blocks: head, visible: false })));
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [...head, { ...reply, text: "Output received while hidden." }],
        visible: true,
      }),
    ),
  );
  expect(container.querySelector(".agent-markdown")?.textContent).toBe(
    "Output received while hidden.",
  );
});

it("paces a burst of tool calls so each enters after the one before it", () => {
  const head: Block[] = [
    { id: "user", role: "user", text: "Review the diff" },
    { id: "intro", role: "assistant", text: "Checking the repo first." },
    tool("first"),
  ];
  render(head);
  render([...head, tool("second"), tool("third"), tool("fourth")]);

  // What was on screen when the group mounted is history; the burst queues.
  expect(stages()).toEqual(["settled", "entering", "waiting", "waiting"]);

  // Later renders must not cut the queue short.
  render([...head, tool("second"), tool("third"), tool("fourth")]);
  expect(stages()).toEqual(["settled", "entering", "waiting", "waiting"]);

  act(() => vi.advanceTimersByTime(480));
  expect(stages()).toEqual(["settled", "entering", "entering", "waiting"]);

  act(() => vi.advanceTimersByTime(480));
  expect(stages()).toEqual(["settled", "entering", "entering", "entering"]);
});
