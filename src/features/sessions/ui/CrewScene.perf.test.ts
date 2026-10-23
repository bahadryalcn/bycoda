// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrewScene } from "./CrewScene";

const state = vi.hoisted(() => ({ enabled: true, paint: vi.fn(), dispose: vi.fn() }));
vi.mock("../../settings/model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => state.enabled,
}));
vi.mock("./crewCodeArt", () => ({
  CODE_WIDTH: 1040,
  CODE_HEIGHT: 300,
  CREW_TOP: 0,
  loadCrewSignLogo: () => Promise.resolve(),
  createCodeArtPainter: () => Object.assign(state.paint, { dispose: state.dispose }),
}));

let root: Root;
let container: HTMLDivElement;
let intersection: IntersectionObserverCallback;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  state.enabled = true;
  state.paint.mockClear();
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const show = (workingCount: number) =>
  act(() => root.render(createElement(CrewScene, { variant: "background", workingCount })));
const enter = () =>
  act(() =>
    intersection(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
const settle = (ms = 5_000) => act(() => vi.advanceTimersByTime(ms));

describe("crew scene background loop", () => {
  // perf P6: no repaint timer for a crew that is not working.
  it("keeps no repeating timer while no agent is working", () => {
    show(0);
    enter();
    settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  // perf P6: a crew that stays idle must stop repainting.
  it("stops repainting after an idle crew has settled", () => {
    show(0);
    enter();
    settle();
    const painted = state.paint.mock.calls.length;
    settle(10_000);
    expect(state.paint.mock.calls.length - painted).toBe(0);
  });

  it("animates while agents are working", () => {
    show(3);
    enter();
    settle(1_000);
    const painted = state.paint.mock.calls.length;
    settle(2_000);
    expect(state.paint.mock.calls.length).toBeGreaterThan(painted);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("runs no timers while scrolled out of view", () => {
    show(3);
    enter();
    act(() =>
      intersection(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    settle(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs no timers when decorative motion is off", () => {
    state.enabled = false;
    show(3);
    enter();
    settle(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases its loop and painter on unmount", () => {
    show(3);
    enter();
    settle(1_000);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(state.dispose).toHaveBeenCalled();
    root = createRoot(container);
  });
});
