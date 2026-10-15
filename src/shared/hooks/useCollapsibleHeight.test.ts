// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCollapsibleHeight } from "./useCollapsibleHeight";

let container: HTMLDivElement;
let root: Root;
let nextFrame: FrameRequestCallback | undefined;
let renders: number;

function Fixture({ open, immediate = false }: { open: boolean; immediate?: boolean }) {
  renders++;
  const { viewportRef, contentRef, settledOpen } = useCollapsibleHeight(open, immediate);
  return createElement(
    "div",
    { ref: viewportRef, "data-settled": settledOpen },
    createElement("div", { ref: contentRef }, "Projects"),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrame = callback;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    nextFrame = undefined;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  renders = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(open: boolean, immediate = false) {
  act(() => root.render(createElement(Fixture, { open, immediate })));
}

function finish(viewport: HTMLElement) {
  const event = new Event("transitionend");
  Object.defineProperty(event, "propertyName", { value: "height" });
  act(() => viewport.dispatchEvent(event));
}

it("measures one target height and lets CSS animate without React frames", () => {
  render(false);
  const viewport = container.firstElementChild as HTMLDivElement;
  const content = viewport.firstElementChild as HTMLDivElement;
  const measure = vi.fn(() => 480);
  Object.defineProperty(content, "scrollHeight", { get: measure });
  render(true);
  expect(measure).toHaveBeenCalledTimes(1);
  expect(viewport.dataset.animating).toBe("true");
  expect(viewport.dataset.settled).toBe("false");
  const beforeFrame = renders;
  act(() => nextFrame?.(0));
  expect(viewport.style.height).toBe("480px");
  expect(renders).toBe(beforeFrame);
  finish(viewport);
  expect(viewport.style.height).toBe("auto");
  expect(viewport.dataset.animating).toBeUndefined();
  expect(viewport.dataset.settled).toBe("true");
});

it("reverses from the visible height and cancels obsolete completion work", () => {
  render(true);
  const viewport = container.firstElementChild as HTMLDivElement;
  const content = viewport.firstElementChild as HTMLDivElement;
  Object.defineProperty(content, "scrollHeight", { value: 480 });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    height: 180,
  } as DOMRect);
  render(false);
  act(() => nextFrame?.(0));
  expect(viewport.style.height).toBe("0px");
  render(true);
  expect(viewport.style.height).toBe("180px");
  act(() => nextFrame?.(0));
  expect(viewport.style.height).toBe("480px");
  act(() => vi.advanceTimersByTime(300));
  expect(viewport.style.height).toBe("auto");
  expect(viewport.dataset.settled).toBe("true");
  expect(viewport.dataset.animating).toBeUndefined();
});

it("folds synchronously for drag measurement without queued motion", () => {
  render(true);
  render(false, true);
  const viewport = container.firstElementChild as HTMLDivElement;
  expect(viewport.style.height).toBe("0px");
  expect(viewport.style.transition).toBe("none");
  expect(viewport.dataset.animating).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
