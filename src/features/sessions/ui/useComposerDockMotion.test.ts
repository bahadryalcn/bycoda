// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readingMotionFrames,
  useComposerDockMotion,
  useComposerReadingMotion,
} from "./useComposerDockMotion";

let container: HTMLDivElement;
let root: Root;
let motion: ReturnType<typeof useComposerDockMotion>;
let animate: ReturnType<typeof vi.fn>;
let reduce = false;

function Harness({ docked }: { docked: boolean }) {
  motion = useComposerDockMotion(docked);
  return docked
    ? createElement("div", { ref: motion.dockedRef, "data-slot": "docked" })
    : createElement("div", { ref: motion.centeredRef, "data-slot": "center" });
}

function render(docked: boolean) {
  act(() => root.render(createElement(Harness, { docked })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reduce = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (
      this.dataset.slot === "center"
        ? { top: 300, left: 100, width: 600 }
        : { top: 700, left: 50, width: 700 }
    ) as DOMRect;
  });
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  HTMLElement.prototype.animate = animate as never;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useComposerDockMotion", () => {
  it("drops the composer straight down to the dock after a submit", () => {
    render(false);
    motion.captureLaunch();
    render(true);

    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0];
    expect(frames[0]).toEqual({ transform: "translate(0px, -400px)" });
  });

  it("does not animate when the composer docks without a submit", () => {
    render(false);
    render(true);

    expect(animate).not.toHaveBeenCalled();
  });

  it("respects reduced motion", () => {
    reduce = true;
    render(false);
    motion.captureLaunch();
    render(true);

    expect(animate).not.toHaveBeenCalled();
  });
});

describe("readingMotionFrames", () => {
  it("eases only the occupied height between the two layouts", () => {
    expect(readingMotionFrames(180, 96)).toEqual([{ height: "180px" }, { height: "96px" }]);
  });

  it("skips unmeasured, unchanged and sub-pixel changes", () => {
    expect(readingMotionFrames(0, 96)).toBeNull();
    expect(readingMotionFrames(96, 96)).toBeNull();
    expect(readingMotionFrames(96, 97)).toBeNull();
  });
});

describe("useComposerReadingMotion", () => {
  let height = 180;
  function ReadingHarness({ reading }: { reading: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useComposerReadingMotion(ref, true, reading);
    return createElement("div", { ref, "data-slot": "reading" });
  }
  function renderReading(reading: boolean) {
    act(() => root.render(createElement(ReadingHarness, { reading })));
  }
  beforeEach(() => {
    height = 180;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
    animate = vi.fn(() => ({ cancel: vi.fn(), addEventListener: vi.fn() }));
    HTMLElement.prototype.animate = animate as never;
  });

  it("animates the dock height from the previous layout when reading mode toggles", () => {
    renderReading(false);
    height = 96;
    renderReading(true);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual([{ height: "180px" }, { height: "96px" }]);
    expect(container.querySelector<HTMLElement>("[data-slot=reading]")!.style.overflowY).toBe(
      "clip",
    );
  });

  it("does not animate on first render or when the mode is unchanged", () => {
    renderReading(false);
    renderReading(false);
    expect(animate).not.toHaveBeenCalled();
  });

  it("changes the layout without a transition under reduced motion", () => {
    reduce = true;
    renderReading(false);
    height = 96;
    renderReading(true);
    expect(animate).not.toHaveBeenCalled();
  });

  it("asks anchored popovers to re-read their trigger when the swap moves it", () => {
    const scrolled = vi.fn();
    window.addEventListener("scroll", scrolled, true);
    renderReading(false);
    height = 96;
    renderReading(true);
    window.removeEventListener("scroll", scrolled, true);
    expect(scrolled).toHaveBeenCalled();
  });

  it("does not ease the swap while a menu is open", () => {
    renderReading(false);
    const menu = document.createElement("div");
    menu.dataset.popoverSide = "top";
    document.body.append(menu);
    height = 96;
    renderReading(true);
    menu.remove();
    expect(animate).not.toHaveBeenCalled();
  });
});
