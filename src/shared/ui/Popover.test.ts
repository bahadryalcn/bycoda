// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Popover } from "./Popover";

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;
let frames: Map<number, FrameRequestCallback>;
let resized: () => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  anchor = document.createElement("button");
  container = document.createElement("div");
  document.body.append(anchor, container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  anchor.remove();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function frame() {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(performance.now())));
}

it("autofocuses after the measuring frame becomes visible", async () => {
  const hiddenFrames: boolean[] = [];
  const nativeFocus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    hiddenFrames.push(this.parentElement?.style.visibility === "hidden");
    nativeFocus.call(this, options);
  });
  await act(async () =>
    root.render(createElement(Popover, { anchor, autoFocus: true, tabIndex: -1 }, "Menu")),
  );
  expect(hiddenFrames).toEqual([false]);
  expect(document.activeElement?.textContent).toBe("Menu");
});

it("places before first paint, coalesces scroll/resize bursts and cancels queued placement on close", async () => {
  const measure = vi
    .spyOn(anchor, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(40, 50, 80, 20));
  await act(async () => root.render(createElement(Popover, { anchor, bare: true }, "Menu")));
  expect(measure).toHaveBeenCalledTimes(1);
  await frame();
  const surface = document.querySelector<HTMLElement>("[data-popover-side]")!;
  const initialTop = Number.parseFloat(surface.style.top);
  measure.mockReturnValue(new DOMRect(40, 110, 80, 20));
  measure.mockClear();
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
      resized();
    }
  });
  expect(measure).not.toHaveBeenCalled();
  await frame();
  expect(measure).toHaveBeenCalledTimes(1);
  expect(Number.parseFloat(surface.style.top)).toBe(initialTop + 60);
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    root.render(null);
  });
  await frame();
  expect(measure).toHaveBeenCalledTimes(1);
});

it("keeps the frame but paints no backdrop glass when solid", async () => {
  await act(async () =>
    root.render(createElement(Popover, { anchor, solid: true }, createElement("p", null, "x"))),
  );
  expect(document.body.querySelector(".popover-solid")).not.toBeNull();
  expect(document.body.querySelector(".popover-backdrop, .backdrop-blur-xl")).toBeNull();
});
