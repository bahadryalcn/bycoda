// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getComposerDraft, setComposerDraft } from "../model/draftCache";
import { useSessionComposerDraft } from "./useSessionComposerDraft";

type Draft = ReturnType<typeof useSessionComposerDraft>;

let root: Root;
let host: HTMLElement;
let current: Draft;
let renders: number;
const touched = new Set<string>();

function mount() {
  function Probe({ sessionId }: { sessionId: string }) {
    renders += 1;
    current = useSessionComposerDraft(sessionId);
    return createElement("output", null, `${current.present}:${current.initialDraft ?? ""}`);
  }
  return {
    render: (sessionId: string) =>
      act(async () => root.render(createElement(Probe, { sessionId }))),
  };
}

function seed(sessionId: string, text: string) {
  touched.add(sessionId);
  setComposerDraft(sessionId, text);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  renders = 0;
});

afterEach(() => {
  act(() => root.unmount());
  for (const id of touched) setComposerDraft(id, "");
  touched.clear();
  vi.unstubAllGlobals();
});

it("restores the cache once, commits edits and never reintroduces a consumed seed", async () => {
  const sessionId = "parent-draft-echo-regression";
  seed(sessionId, "Restored draft 👩🏽‍💻");
  const view = mount();
  await view.render(sessionId);
  expect(current.initialDraft).toBe("Restored draft 👩🏽‍💻");
  expect(current.present).toBe(true);
  expect(current.text()).toBe("Restored draft 👩🏽‍💻");
  await act(async () => current.change("New unsent text"));
  expect(current.text()).toBe("New unsent text");
  expect(current.initialDraft).toBeUndefined();
  await act(async () => current.change(""));
  // An emptied draft is still a draft the user owns, not a fresh seedable session.
  expect(current.present).toBe(true);
  expect(current.text()).toBe("");
  expect(current.initialDraft).toBeUndefined();
  await view.render(sessionId);
  expect(current.initialDraft).toBeUndefined();
  // The existing parent publisher still owns cache writes and admission.
  expect(getComposerDraft(sessionId)).toBe("Restored draft 👩🏽‍💻");
});

it("keeps the parent idle while typing: only the first edit renders, later keystrokes bail out", async () => {
  const sessionId = "parent-draft-typing-idle";
  seed(sessionId, "restored");
  const view = mount();
  await view.render(sessionId);
  await act(async () => current.change("restored!"));
  const afterFirstEdit = renders;
  const text = "a longer unsent message, typed one character at a time 👩🏽‍💻";
  for (let end = 1; end <= text.length; end += 1) {
    await act(async () => current.change(text.slice(0, end)));
    expect(current.text()).toBe(text.slice(0, end));
  }
  expect(renders).toBe(afterFirstEdit);
  expect(current.initialDraft).toBeUndefined();
});

it("reports no draft for a session that never had one, then present after the first edit", async () => {
  const sessionId = "parent-draft-never-had-one";
  const view = mount();
  await view.render(sessionId);
  expect(current.present).toBe(false);
  expect(current.initialDraft).toBeUndefined();
  expect(current.text()).toBeUndefined();
  await act(async () => current.change("x"));
  expect(current.present).toBe(true);
  await act(async () => current.change("xy"));
  expect(current.present).toBe(true);
});

it("a reused pane takes the next session's cache and never the previous session's text or seed", async () => {
  const first = "parent-draft-switch-a";
  const second = "parent-draft-switch-b";
  const third = "parent-draft-switch-c";
  seed(first, "first restored");
  seed(second, "second restored");
  const view = mount();
  await view.render(first);
  await act(async () => current.change("first edited"));
  expect(current.text()).toBe("first edited");
  await view.render(second);
  expect(current.present).toBe(true);
  expect(current.initialDraft).toBe("second restored");
  expect(current.text()).toBe("second restored");
  await view.render(third);
  expect(current.present).toBe(false);
  expect(current.initialDraft).toBeUndefined();
  expect(current.text()).toBeUndefined();
  await act(async () => current.change("third edited"));
  await view.render(first);
  // Returning to a session reads its own cache, not the edit another session made.
  expect(current.text()).toBe("first restored");
  expect(current.initialDraft).toBe("first restored");
});
