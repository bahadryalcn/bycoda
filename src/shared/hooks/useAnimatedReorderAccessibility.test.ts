// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDropFeedback, setGrabbing } from "../lib/drag";
import { useAnimatedReorder } from "./useAnimatedReorder";

type Reorder = ReturnType<typeof useAnimatedReorder<string>>;

let host: HTMLElement;
let root: Root;
let reorder: Reorder;
const onReorder = vi.fn();
const live = () => document.querySelector("[data-drag-announcer]")?.textContent ?? "";

function Probe({ ids, axis }: { ids: string[]; axis: "x" | "y" }) {
  const sortable = useAnimatedReorder(ids, onReorder, axis);
  useLayoutEffect(() => {
    reorder = sortable;
  });
  return createElement(
    "div",
    null,
    ids.map((id) =>
      createElement("button", {
        key: id,
        id,
        "aria-label": `Tab ${id}`,
        ref: (node: HTMLElement | null) => sortable.setItemRef(id, node),
        onKeyDown: (event: React.KeyboardEvent) => sortable.onItemKeyDown(id, event),
      }),
    ),
  );
}

async function mount(ids = ["a", "b", "c"], axis: "x" | "y" = "x") {
  await act(async () => root.render(createElement(Probe, { ids, axis })));
}

function key(id: string, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    host.querySelector<HTMLElement>(`#${id}`)!.dispatchEvent(event);
  });
  return event;
}

function press(id: string, x = 10) {
  let started = false;
  act(() => {
    started = reorder.onItemPointerDown(id, {
      button: 0,
      clientX: x,
      clientY: x,
      pointerId: 1,
    } as ReactPointerEvent) as unknown as boolean;
  });
  return started;
}

function windowEvent(type: string, init: Record<string, unknown> = {}) {
  act(() => {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), init));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onReorder.mockReset();
  vi.spyOn(window, "matchMedia").mockImplementation(
    () => ({ matches: true }) as unknown as MediaQueryList,
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  setGrabbing(false);
  clearDropFeedback();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("keyboard and menu moves", () => {
  it("moves a horizontal item with Alt+Arrow and announces its new place", async () => {
    await mount();
    const event = key("b", { key: "ArrowRight", altKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["a", "c", "b"], "b");
    expect(live()).toBe("Moved Tab b to position 3 of 3");
  });

  it("uses Alt+Up/Down for vertical lists and ignores the horizontal arrows", async () => {
    await mount(["a", "b", "c"], "y");
    key("b", { key: "ArrowRight", altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
    key("b", { key: "ArrowUp", altKey: true });
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"], "b");
  });

  it.each([
    ["plain arrow", { key: "ArrowRight" }],
    ["Ctrl+Alt", { key: "ArrowRight", altKey: true, ctrlKey: true }],
    ["Shift+Alt", { key: "ArrowRight", altKey: true, shiftKey: true }],
    ["other key", { key: "x", altKey: true }],
  ])("leaves %s to the item", async (_name, init) => {
    await mount();
    const event = key("a", init);
    expect(event.defaultPrevented).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("says so at the edge instead of reordering", async () => {
    await mount();
    key("a", { key: "ArrowLeft", altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
    expect(live()).toBe("Tab a stays at position 1 of 3");
  });

  it("reverses the horizontal arrows in a right-to-left document", async () => {
    document.documentElement.dir = "rtl";
    try {
      await mount();
      key("a", { key: "ArrowLeft", altKey: true });
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"], "a");
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  });

  it("moves by menu step and keeps focus on the moved item", async () => {
    await mount();
    const button = host.querySelector<HTMLElement>("#b")!;
    button.focus();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const focus = vi.spyOn(button, "focus");
    button.blur();
    expect(reorder.moveBy("b", -1)).toBe(true);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"], "b");
    // Focus was not inside the item when it moved, so it is not stolen.
    expect(focus).not.toHaveBeenCalled();
  });

  it("restores focus that a reorder dropped from the moved item", async () => {
    await mount();
    const button = host.querySelector<HTMLElement>("#b")!;
    button.focus();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    reorder.moveBy("b", 1);
    button.blur();
    frames.forEach((frame) => frame(0));
    expect(document.activeElement).toBe(button);
  });
});

describe("pointer drag cleanup and announcements", () => {
  async function startDrag() {
    await mount();
    expect(press("a")).toBe(true);
    windowEvent("pointermove", {
      pointerId: 1,
      clientX: 40,
      clientY: 40,
      buttons: 1,
      pointerType: "mouse",
    });
    const item = host.querySelector<HTMLElement>("#a")!;
    expect(item.dataset.dragging).toBe("true");
    expect(document.documentElement.classList.contains("is-grabbing")).toBe(true);
    return item;
  }

  it("announces the pick-up once, not per pointer move", async () => {
    await startDrag();
    expect(live()).toBe("Picked up Tab a, position 1 of 3. Escape cancels.");
    windowEvent("pointermove", {
      pointerId: 1,
      clientX: 41,
      clientY: 41,
      buttons: 1,
      pointerType: "mouse",
    });
    expect(live()).toBe("Picked up Tab a, position 1 of 3. Escape cancels.");
  });

  it.each([
    ["Escape", () => windowEvent("keydown", { key: "Escape" })],
    ["pointercancel", () => windowEvent("pointercancel", { pointerId: 1 })],
    ["blur", () => windowEvent("blur")],
  ])("%s cancels without reordering, cleans up and announces", async (_name, cancel) => {
    const item = await startDrag();
    cancel();
    expect(onReorder).not.toHaveBeenCalled();
    expect(live()).toBe("Move cancelled. Tab a stays at position 1 of 3.");
    expect(item.dataset.dragging).toBeUndefined();
    expect(document.documentElement.classList.contains("is-grabbing")).toBe(false);
    expect(document.documentElement.classList.contains("is-reordering")).toBe(false);
    expect(document.body.style.cursor).toBe("");
  });

  it("releases the gesture when the list unmounts mid-drag", async () => {
    const item = await startDrag();
    await act(async () => root.render(createElement("div")));
    expect(item.dataset.dragging).toBeUndefined();
    expect(document.documentElement.classList.contains("is-grabbing")).toBe(false);
    windowEvent("pointerup", { pointerId: 1, clientX: 80, clientY: 80 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("refuses a keyboard move while a pointer drag owns the list", async () => {
    await startDrag();
    expect(reorder.moveBy("b", 1)).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
