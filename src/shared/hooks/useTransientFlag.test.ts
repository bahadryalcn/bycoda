// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTransientFlag } from "./useTransientFlag";

it("tekrar tetiklenince süreyi yeniler ve unmount sonrası timer bırakmaz", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  let flag = false;
  let set!: (value: boolean) => void;
  function Probe() {
    [flag, set] = useTransientFlag(2000);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  act(() => set(true));
  act(() => vi.advanceTimersByTime(1500));
  act(() => set(true));
  act(() => vi.advanceTimersByTime(1000));
  expect(flag).toBe(true);
  act(() => vi.advanceTimersByTime(1000));
  expect(flag).toBe(false);
  act(() => set(true));
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  act(() => set(true));
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
