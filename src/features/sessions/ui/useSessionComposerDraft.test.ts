// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getComposerDraft, setComposerDraft } from "../model/draftCache";
import { useSessionComposerDraft } from "./useSessionComposerDraft";

it("restores the cache once, commits edits and never reintroduces a consumed seed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sessionId = "parent-draft-echo-regression";
  setComposerDraft(sessionId, "Restored draft 👩🏽‍💻");
  const host = document.createElement("div");
  const root = createRoot(host);
  let current!: ReturnType<typeof useSessionComposerDraft>;
  function Probe() {
    current = useSessionComposerDraft(sessionId);
    return createElement("output", null, current.value);
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(current.initialDraft).toBe("Restored draft 👩🏽‍💻");
    expect(current.value).toBe("Restored draft 👩🏽‍💻");
    await act(async () => current.change("New unsent text"));
    expect(current.value).toBe("New unsent text");
    expect(current.initialDraft).toBeUndefined();
    await act(async () => current.change(""));
    expect(current.value).toBe("");
    expect(current.initialDraft).toBeUndefined();
    await act(async () => root.render(createElement(Probe)));
    expect(current.value).toBe("");
    // The existing parent publisher still owns cache writes and admission.
    expect(getComposerDraft(sessionId)).toBe("Restored draft 👩🏽‍💻");
  } finally {
    act(() => root.unmount());
    setComposerDraft(sessionId, "");
    vi.unstubAllGlobals();
  }
});
