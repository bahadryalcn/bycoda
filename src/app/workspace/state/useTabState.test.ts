// @vitest-environment happy-dom
import { act, createElement, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useActiveTabSetter } from "./useTabState";

it("requests composer focus and leaves the terminal on every explicit session activation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const cancel = vi.fn();
  const setActiveTabIdState = vi.fn();
  const setProjectTerminalFocused = vi.fn();
  let token = 0;
  const setComposerFocusToken = vi.fn((update: SetStateAction<number>) => {
    token = typeof update === "function" ? update(token) : update;
  });
  let activate!: (id: string) => void;
  function Harness() {
    activate = useActiveTabSetter({
      cancel,
      setActiveTabIdState,
      setProjectTerminalFocused,
      setComposerFocusToken,
    });
    return null;
  }
  try {
    act(() => root.render(createElement(Harness)));
    act(() => activate("new-session"));
    act(() => activate("existing-session"));
    act(() => activate("existing-session"));
    expect(token).toBe(3);
    expect(setProjectTerminalFocused).toHaveBeenCalledTimes(3);
    expect(setProjectTerminalFocused).toHaveBeenLastCalledWith(false);
    expect(setActiveTabIdState).toHaveBeenLastCalledWith("existing-session");
    expect(cancel).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
