// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useOwnedTimeout } from "./useOwnedTimeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("cancels pending work and refuses work submitted by stale async callbacks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  let defer!: ReturnType<typeof useOwnedTimeout>;
  function Owner() {
    defer = useOwnedTimeout();
    return null;
  }
  await act(async () => root.render(createElement(StrictMode, null, createElement(Owner))));
  const callback = vi.fn();
  defer(callback, 150);
  await act(async () => vi.advanceTimersByTime(150));
  expect(callback).toHaveBeenCalledOnce();
  defer(callback, 150);
  await act(async () => root.unmount());
  defer(callback, 0);
  await act(async () => vi.runAllTimers());
  expect(callback).toHaveBeenCalledOnce();
});
