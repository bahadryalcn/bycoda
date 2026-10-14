// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMouseNavigation } from "./useMouseNavigation";

function Harness(props: { back: () => void; forward: () => void }) {
  useMouseNavigation(props.back, props.forward);
  return createElement("textarea");
}

let container: HTMLDivElement;
let root: Root;
let back: ReturnType<typeof vi.fn>;
let forward: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  back = vi.fn();
  forward = vi.fn();
  act(() => root.render(createElement(Harness, { back, forward })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function click(button: number) {
  const target = container.querySelector("textarea")!;
  return ["mousedown", "mouseup", "auxclick"].map((type) => {
    const event = new MouseEvent(type, {
      button,
      bubbles: true,
      cancelable: true,
    });
    act(() => target.dispatchEvent(event));
    return event;
  });
}

describe("mouse navigation", () => {
  it("navigates once per side-button press and cancels native history", () => {
    expect(click(3).every((event) => event.defaultPrevented)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(click(4).every((event) => event.defaultPrevented)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("leaves primary, middle and context-menu buttons alone", () => {
    for (const button of [0, 1, 2]) {
      expect(click(button).some((event) => event.defaultPrevented)).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("captures navigation before editor or terminal mouse handlers", () => {
    const handler = vi.fn((event: Event) => event.stopPropagation());
    container.querySelector("textarea")!.addEventListener("mousedown", handler);
    click(3);
    expect(back).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("uses the latest shell callbacks after the current view changes", () => {
    const updatedBack = vi.fn();
    const updatedForward = vi.fn();
    act(() => root.render(createElement(Harness, { back: updatedBack, forward: updatedForward })));
    click(3);
    click(4);
    expect(updatedBack).toHaveBeenCalledTimes(1);
    expect(updatedForward).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("supports browser keys from mouse drivers without repeated navigation", () => {
    for (const [key, repeat] of [
      ["BrowserBack", false],
      ["BrowserForward", false],
      ["BrowserBack", true],
    ] as const) {
      const event = new KeyboardEvent("keydown", {
        key,
        repeat,
        bubbles: true,
        cancelable: true,
      });
      act(() => container.querySelector("textarea")!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("removes mouse and keyboard listeners on unmount", () => {
    act(() => root.render(null));
    const mouse = new MouseEvent("mousedown", { button: 3, cancelable: true });
    const key = new KeyboardEvent("keydown", {
      key: "BrowserForward",
      cancelable: true,
    });
    window.dispatchEvent(mouse);
    window.dispatchEvent(key);
    expect(mouse.defaultPrevented).toBe(false);
    expect(key.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });
});
