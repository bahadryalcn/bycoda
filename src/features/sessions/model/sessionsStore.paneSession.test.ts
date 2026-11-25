// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyHarnessEvents } from "../../../integrations/harness/core/apply";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import type { Block, Session } from "./session";
import {
  isTextOnlyChange,
  resetSessionsStore,
  sameOptionalSessionIgnoringStreamingText,
  setSessions,
  usePaneSession,
  usePaneSessionBlocks,
} from "./sessionsStore";

const user: Block = { id: "u1", role: "user", text: "hi" };
const reply: Block = { id: "a1", role: "assistant", text: "He", streaming: true };

function session(overrides: Partial<Session> = {}): Session {
  return { id: "s1", busy: true, blocks: [user, reply], ...overrides } as Session;
}

function mount(equal?: typeof sameOptionalSessionIgnoringStreamingText) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const seen: Array<Session | undefined> = [];
  function Probe() {
    seen.push(usePaneSession("s1", true, equal));
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return { seen, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  resetSessionsStore([session()]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("pane subscription skips text-only frames but re-renders for status changes", () => {
  const view = mount(sameOptionalSessionIgnoringStreamingText);
  const renders = view.seen.length;

  act(() => {
    setSessions([session({ blocks: [user, { ...reply, text: "Hello" }] })]);
  });
  expect(view.seen).toHaveLength(renders);

  act(() => {
    setSessions([
      session({ busy: false, blocks: [user, { ...reply, text: "Hello world", streaming: false }] }),
    ]);
  });
  expect(view.seen).toHaveLength(renders + 1);
  const latest = view.seen[view.seen.length - 1];
  expect(latest?.busy).toBe(false);
  expect(latest?.blocks[1]).toMatchObject({ text: "Hello world" });
  view.unmount();
});

it("default equality still receives every text frame", () => {
  const view = mount();
  const renders = view.seen.length;

  act(() => {
    setSessions([session({ blocks: [user, { ...reply, text: "Hello" }] })]);
  });
  expect(view.seen).toHaveLength(renders + 1);
  view.unmount();
});

it.each(["interleaved text", "tool output"])(
  "keeps the pane stable while the transcript receives %s and catches up after being parked",
  (scenario) => {
    const output = scenario === "tool output";
    const initialEvents: HarnessEvent[] = output
      ? [
          {
            type: "tool.started",
            callId: "run",
            title: "Run tests",
            kind: "execute",
            status: "in_progress",
            preview: { kind: "shell", inspection: { kind: "command", text: "pnpm test" } },
          },
        ]
      : [
          { type: "message.delta", text: "start" },
          { type: "status", text: "warning" },
        ];
    let current = applyHarnessEvents(session({ blocks: [user] }), initialEvents);
    resetSessionsStore([current]);
    const view = mount(sameOptionalSessionIgnoringStreamingText);
    const panes = view.seen.length;
    const container = document.createElement("div");
    const root = createRoot(container);
    function Transcript({ visible }: { visible: boolean }) {
      const blocks = usePaneSessionBlocks("s1", visible, true);
      const block = blocks?.find((entry) => entry.role === (output ? "tool" : "assistant"));
      return output ? (block?.tool?.detail ?? "") : (block?.text ?? "");
    }
    const show = (visible: boolean) =>
      act(() => root.render(createElement(Transcript, { visible })));
    const emit = (event: HarnessEvent) =>
      act(() => {
        current = applyHarnessEvents(current, [event]);
        setSessions([current]);
      });
    const frame = (text: string): HarnessEvent =>
      output
        ? { type: "tool.updated", callId: "run", status: "in_progress", detail: text }
        : { type: "message.delta", text };
    try {
      show(true);
      emit(frame("one"));
      expect(container.textContent).toContain("one");
      show(false);
      emit(frame("two"));
      show(true);
      expect(container.textContent).toContain("two");
      expect(view.seen).toHaveLength(panes);
      emit(
        output
          ? { type: "tool.updated", callId: "run", status: "completed", detail: "done" }
          : { type: "status", text: "another warning" },
      );
      expect(view.seen.at(-1)).toBe(current);
    } finally {
      act(() => root.unmount());
      view.unmount();
    }
  },
);

it("publishes preview and delegation results that affect other controls", () => {
  for (const title of ["Run tests", "agents.delegate"]) {
    const before = applyHarnessEvents(session({ blocks: [user] }), [
      { type: "tool.started", callId: "call", title, status: "in_progress" },
    ]);
    const after = applyHarnessEvents(before, [
      {
        type: "tool.updated",
        callId: "call",
        status: "in_progress",
        ...(title === "Run tests"
          ? { preview: { kind: "shell" as const, title: "Tests", output: "new preview" } }
          : { detail: '{"sessionId":"child"}' }),
      },
    ]);
    expect(sameOptionalSessionIgnoringStreamingText(before, after)).toBe(false);
    expect(isTextOnlyChange([before], [after])).toBe(false);
  }
});
