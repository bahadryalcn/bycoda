// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationVisibility } from "./presentationVisibility";
import { useElapsedFrom } from "./useElapsedFrom";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("turn elapsed time across system sleep", () => {
  it("does not count a suspended span mid-turn, matching the Host run-limit accounting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const result = { current: 0 };
    const host = document.createElement("div");
    const root = createRoot(host);
    function Probe() {
      result.current = useElapsedFrom(10000, false) ?? -1;
      return null;
    }
    act(() =>
      root.render(
        createElement(PresentationVisibility.Provider, { value: true }, createElement(Probe)),
      ),
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1000);

    // Laptop sleeps for eight hours; the wall clock jumps while the 1 s tick is pending.
    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    act(() => {
      vi.setSystemTime(Date.now() + EIGHT_HOURS);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2000);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(3000);
    act(() => root.unmount());
  });
});
