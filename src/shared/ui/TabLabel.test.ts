// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TabLabel } from "./TabLabel";

it("fades only real overflow, remeasures resize/rename and disconnects observers", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let width = 100;
  let textWidth = 80;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => textWidth);
  const observers: {
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({
          callback,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(TabLabel, null, "Short")));
    const label = container.querySelector("span")!;
    expect(label.hasAttribute("data-overflow")).toBe(false);
    expect(observers[0].observe).toHaveBeenCalledWith(label);
    textWidth = 150;
    act(() => observers[0].callback([], {} as ResizeObserver));
    expect(label.getAttribute("data-overflow")).toBe("true");
    width = 200;
    act(() => observers[0].callback([], {} as ResizeObserver));
    expect(label.hasAttribute("data-overflow")).toBe(false);
    width = 100;
    textWidth = 160;
    act(() => root.render(createElement(TabLabel, null, "A longer renamed tab")));
    expect(label.getAttribute("data-overflow")).toBe("true");
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
