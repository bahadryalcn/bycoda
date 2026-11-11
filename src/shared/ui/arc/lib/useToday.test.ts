// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Timestamp } from "../../Timestamp";

it("keeps one day timer and one listener pair for any number of timestamps", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const focus = vi.spyOn(window, "addEventListener");
  const visibility = vi.spyOn(document, "addEventListener");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          ...Array.from({ length: 10 }, (_, index) =>
            createElement(Timestamp, { key: index, value: Date.now() }),
          ),
        ),
      ),
    );
    expect(focus.mock.calls.filter(([type]) => String(type) === "focus")).toHaveLength(1);
    expect(visibility.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
