// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginResizeGesture } from "../../../shared/lib/resizeGesture";
import { OverviewRuler } from "./overviewRulerView";

describe("retained editor overview ownership", () => {
  let ruler: OverviewRuler;
  let owner: HTMLDivElement;
  let frame: FrameRequestCallback | undefined;
  const scrollTo = vi.fn();
  const reveal = vi.fn();
  const paint = vi.fn();

  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          setTransform: vi.fn(),
          clearRect: vi.fn(),
          fillRect: paint,
        }) as unknown as CanvasRenderingContext2D,
    );
    owner = document.createElement("div");
    document.body.append(owner);
    ruler = new OverviewRuler(
      {
        marks: () => [{ kind: "mod", top: 10, bottom: 30, pos: 20 }],
        geometry: () => ({ contentHeight: 1000, viewportHeight: 100, scrollTop: 0 }),
        scrollTo,
        reveal,
      },
      { interactive: true, band: false },
    );
    owner.append(ruler.dom);
    Object.defineProperties(ruler.dom, {
      clientHeight: { value: 200 },
      clientWidth: { value: 10 },
    });
  });

  afterEach(() => {
    ruler.destroy();
    owner.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    frame = undefined;
  });

  function draw() {
    ruler.invalidate();
    const callback = frame;
    frame = undefined;
    callback?.(0);
  }

  function wheel(options: WheelEventInit = {}) {
    const event = new WheelEvent("wheel", { deltaY: 40, cancelable: true, ...options });
    // happy-dom's WheelEvent drops modifier init flags; set them like a real browser would.
    for (const key of ["ctrlKey", "shiftKey", "altKey", "metaKey"] as const) {
      if (options[key]) Object.defineProperty(event, key, { value: true });
    }
    ruler.dom.dispatchEvent(event);
    return event;
  }

  it("does not paint, hit or scroll inactive Source, then resumes without rebuilding", () => {
    owner.dataset.fileEditorSourceActive = "false";
    draw();
    expect(paint).not.toHaveBeenCalled();
    expect(wheel().defaultPrevented).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(ruler.tickAt(3)).toBeNull();
    owner.dataset.fileEditorSourceActive = "true";
    draw();
    expect(paint).toHaveBeenCalled();
    expect(wheel().defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(40);
  });

  it("leaves zoom, modified and previously handled wheels to their owner", () => {
    draw();
    for (const key of ["ctrlKey", "shiftKey", "altKey", "metaKey"] as const) {
      expect(wheel({ [key]: true }).defaultPrevented).toBe(false);
    }
    const handled = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
    handled.preventDefault();
    ruler.dom.dispatchEvent(handled);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("rejects stale hit targets immediately when the retained pane becomes inert", () => {
    draw();
    owner.setAttribute("inert", "");
    expect(ruler.tickAt(3)).toBeNull();
    ruler.dom.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientY: 3, cancelable: true }),
    );
    expect(reveal).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not redraw for an ancestor geometry write, but does for a real hide", async () => {
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    draw();
    frame = undefined;
    owner.style.width = "320px";
    owner.style.left = "12px";
    await settle();
    expect(frame).toBeUndefined();
    owner.style.display = "none";
    await settle();
    expect(frame).toBeDefined();
  });

  it("holds a size-driven repaint until the resize gesture ends", () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const sized = new OverviewRuler(
      {
        marks: () => [],
        geometry: () => ({ contentHeight: 1000, viewportHeight: 100, scrollTop: 0 }),
        scrollTo,
        reveal,
      },
      { interactive: false, band: false },
    );
    try {
      frame = undefined;
      const end = beginResizeGesture();
      observers.forEach((callback) => callback());
      expect(frame).toBeUndefined();
      end();
      expect(frame).toBeDefined();
    } finally {
      sized.destroy();
      vi.unstubAllGlobals();
    }
  });
});
