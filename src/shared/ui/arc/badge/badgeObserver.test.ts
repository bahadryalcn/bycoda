// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Badge } from "../../Badge";

it("shares one resize observer across every mounted badge", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let created = 0;
  class FakeObserver {
    constructor() {
      created += 1;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FakeObserver);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          ...Array.from({ length: 12 }, (_, index) =>
            createElement(Badge, { key: index }, `Badge ${index}`),
          ),
        ),
      ),
    );
    expect(created).toBe(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
