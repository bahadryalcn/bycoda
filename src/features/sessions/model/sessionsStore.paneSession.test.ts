// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "./session";
import {
  resetSessionsStore,
  sameOptionalSessionIgnoringStreamingText,
  setSessions,
  usePaneSession,
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
