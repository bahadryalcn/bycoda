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
      unobserve() {}
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
  document.documentElement.style.removeProperty("zoom");
  document.body.style.removeProperty("zoom");
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

it.each([
  [1, 1],
  [1.25, 1],
  [1.25, 1.2],
])(
  "places in portal coordinates for document zoom %s and body zoom %s",
  async (documentZoom, bodyZoom) => {
    document.documentElement.style.setProperty("zoom", String(documentZoom));
    document.body.style.setProperty("zoom", String(bodyZoom));
    // A trigger can have a different local scale; the portal frame does not inherit it.
    anchor.style.setProperty("zoom", "2");
    const zoom = documentZoom * bodyZoom;
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(200 * zoom, 100 * zoom, 80 * zoom, 20 * zoom),
    );
    await act(async () => root.render(createElement(Popover, { anchor, bare: true }, "Menu")));
    const surface = document.querySelector<HTMLElement>("[data-popover-side]")!;
    expect(Number.parseFloat(surface.style.left)).toBeCloseTo(200);
    expect(Number.parseFloat(surface.style.top)).toBeCloseTo(126);
  },
);

it("clamps the full physical width inside the viewport at 125 percent zoom", async () => {
  document.documentElement.style.setProperty("zoom", "1.25");
  vi.stubGlobal("innerWidth", 1000);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(950, 100, 40, 20));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
  await act(async () => root.render(createElement(Popover, { anchor, bare: true }, "Menu")));
  const surface = document.querySelector<HTMLElement>("[data-popover-side]")!;
  expect(Number.parseFloat(surface.style.left)).toBe(592);
  expect((Number.parseFloat(surface.style.left) + 200) * 1.25).toBe(990);
});

it("remeasures intrinsic width when an open picker receives different options", async () => {
  vi.stubGlobal("innerWidth", 800);
  let contentWidth = 280;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.style.width === "max-content"
      ? contentWidth
      : Number.parseFloat(this.style.width) || contentWidth;
  });
  await act(async () => root.render(createElement(Popover, { anchor, minWidth: 240 }, "Loading…")));
  const placed = document.querySelector<HTMLElement>(
    "[data-popover-side]:not([data-popover-flow])",
  )!;
  await frame();
  expect(placed.style.width).toBe("280px");
  contentWidth = 620;
  await act(async () =>
    root.render(createElement(Popover, { anchor, minWidth: 240 }, "Long fetched project path")),
  );
  await vi.waitFor(() => expect(frames.size).toBeGreaterThan(0));
  await frame();
  expect(placed.style.width).toBe("620px");
  contentWidth = 120;
  await act(async () =>
    root.render(createElement(Popover, { anchor, minWidth: 240 }, "Filtered project")),
  );
  await vi.waitFor(() => expect(frames.size).toBeGreaterThan(0));
  await frame();
  expect(placed.style.width).toBe("240px");
});

it("grows a list popup with its longest row up to 800px and never past the viewport", async () => {
  vi.stubGlobal("innerWidth", 1400);
  let contentWidth = 1200;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.style.width === "max-content"
      ? contentWidth
      : Number.parseFloat(this.style.width) || contentWidth;
  });
  await act(async () => root.render(createElement(Popover, { anchor, minWidth: 240 }, "Long row")));
  const placed = document.querySelector<HTMLElement>(
    "[data-popover-side]:not([data-popover-flow])",
  )!;
  await frame();
  expect(placed.style.width).toBe("800px");
  // The hard popup cap also bounds an oversized trigger-width floor.
  await act(async () =>
    root.render(createElement(Popover, { anchor, minWidth: 900 }, "Wide trigger")),
  );
  await vi.waitFor(() => expect(frames.size).toBeGreaterThan(0));
  await frame();
  expect(placed.style.width).toBe("800px");
  // A narrow window clamps below the cap.
  vi.stubGlobal("innerWidth", 500);
  await act(async () =>
    root.render(createElement(Popover, { anchor, minWidth: 240 }, "Narrow window")),
  );
  await vi.waitFor(() => expect(frames.size).toBeGreaterThan(0));
  await frame();
  expect(placed.style.width).toBe("484px");
});

it("bounds the default content so it scrolls instead of clipping, and owns one strict region when asked", async () => {
  await act(async () => root.render(createElement(Popover, { anchor, solid: true }, "Menu")));
  let content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
  expect(content.dataset.popoverFlow).toBe("auto");
  // Low-priority class, not inline: a consumer's own overflow utility or inner rail wins.
  expect(content.style.overflowY).toBe("");
  expect(content.className).toMatch(/bounded/);
  await act(async () =>
    root.render(createElement(Popover, { anchor, solid: true, flow: "intrinsic" }, "Menu")),
  );
  content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
  expect(content.dataset.popoverFlow).toBe("intrinsic");
  expect(content.className).not.toMatch(/bounded/);
  await act(async () =>
    root.render(createElement(Popover, { anchor, solid: true, flow: "scroll" }, "Menu")),
  );
  content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
  expect(content.dataset.popoverFlow).toBe("scroll");
  expect(content.style.overflowY).toBe("auto");
  expect(content.style.overscrollBehavior).toBe("contain");
  expect(content.hasAttribute("flow")).toBe(false);
});

it("does not scroll when the height is not constrained", async () => {
  await act(async () =>
    root.render(createElement(Popover, { anchor, flow: "scroll", constrainHeight: false }, "Menu")),
  );
  let content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
  expect(content.dataset.popoverFlow).toBe("intrinsic");
  expect(content.style.overflowY).toBe("");
  await act(async () =>
    root.render(createElement(Popover, { anchor, constrainHeight: false }, "Menu")),
  );
  content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
  expect(content.dataset.popoverFlow).toBe("intrinsic");
  expect(content.className).not.toMatch(/bounded/);
});

it("bounds a tall popover to the room left in a short window", async () => {
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 440, 80, 20));
  vi.stubGlobal("innerHeight", 520);
  vi.stubGlobal("innerWidth", 800);
  await act(async () => root.render(createElement(Popover, { anchor, width: 200 }, "Menu")));
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 900,
  });
  try {
    await act(async () => resized());
    await frame();
    const placed = document.querySelector<HTMLElement>(
      "[data-popover-side]:not([data-popover-flow])",
    )!;
    // Not enough room below the anchor: opens above it and is capped to the room there.
    expect(placed.dataset.popoverSide).toBe("top");
    const room = 440 - 6 - 8;
    expect(Number.parseFloat(placed.style.maxHeight)).toBe(room);
    const content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
    expect(Number.parseFloat(content.style.maxHeight)).toBeLessThanOrEqual(room);
  } finally {
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  }
});

it("treats scrolling inside the popover as neither a re-placement nor an outside dismissal", async () => {
  const measure = vi
    .spyOn(anchor, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(40, 50, 80, 20));
  const dismiss = vi.fn();
  await act(async () =>
    root.render(createElement(Popover, { anchor, flow: "scroll", onDismiss: dismiss }, "Menu")),
  );
  await frame();
  const content = document.querySelector<HTMLElement>("[data-popover-flow]")!;
  measure.mockClear();
  await act(async () => {
    content.dispatchEvent(new Event("scroll"));
    content.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true }));
  });
  await frame();
  expect(measure).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
  // A scroll elsewhere still follows the anchor.
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
  });
  await frame();
  expect(measure).toHaveBeenCalledTimes(1);
});

it("keeps a passive tooltip out of Escape handling", async () => {
  const dismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        Popover,
        { anchor, role: "tooltip", passive: true, restoreFocus: false, onDismiss: dismiss },
        "Hint",
      ),
    ),
  );
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(dismiss).not.toHaveBeenCalledWith("escape");
});

it("dismisses on an outside press even when its target stops pointerdown propagation", async () => {
  const onDismiss = vi.fn();
  const outside = document.createElement("div");
  outside.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.body.append(outside);
  await act(async () =>
    root.render(createElement(Popover, { anchor, onDismiss, bare: true }, "Menu")),
  );
  outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(onDismiss).toHaveBeenCalledWith("outside");
  outside.remove();
});

it("hides while its anchor is not rendered and returns once the anchor shows again", async () => {
  // A composer in a background session tab is display:none; its open picker must not jump to 0,0.
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 50, 80, 20));
  await act(async () => root.render(createElement(Popover, { anchor, bare: true }, "Menu")));
  await frame();
  const surface = document.querySelector<HTMLElement>("[data-popover-side]")!;
  expect(surface.style.visibility).not.toBe("hidden");
  anchor.style.display = "none";
  await act(async () => resized());
  await frame();
  expect(surface.style.visibility).toBe("hidden");
  anchor.style.display = "";
  await act(async () => resized());
  await frame();
  expect(surface.style.visibility).not.toBe("hidden");
  expect(Number.parseFloat(surface.style.left)).toBe(40);
});
