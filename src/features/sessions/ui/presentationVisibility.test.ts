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
describe("parked elapsed presentation", () => {
  it("does not tick while parked and resumes from actual elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let visible = true;
    const result = { current: 0 };
    const host = document.createElement("div");
    const root = createRoot(host);
    function Probe() {
      result.current = useElapsedFrom(10000, false);
      return null;
    }
    const rerender = () =>
      act(() =>
        root.render(
          createElement(PresentationVisibility.Provider, { value: visible }, createElement(Probe)),
        ),
      );
    rerender();
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1000);
    visible = false;
    rerender();
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(1000);
    visible = true;
    rerender();
    expect(result.current).toBe(6000);
    act(() => root.unmount());
  });
});
