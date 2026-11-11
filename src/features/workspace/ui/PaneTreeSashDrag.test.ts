// @vitest-environment happy-dom
import {
  act,
  createElement,
  Profiler,
  type ComponentProps,
  type ProfilerOnRenderCallback,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paneBackgroundPlacement } from "../../../shared/lib/paneBackground";
import { newSession } from "../../sessions/model/session";
import { leaf, layoutLeaves, setSplitRatio, splitPane } from "../model/layout";
import { PaneTree } from "./PaneTree";

vi.mock("../../files/ui/FilePane", () => ({ FilePane: () => null }));
vi.mock("../../sessions/ui/SessionPane", async () => {
  const { createElement } = await import("react");
  return {
    SessionPane: ({ session }: any) => createElement("div", { "data-session": session.id }),
  };
});

let container: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tree = splitPane(leaf("a"), "a", "right", "b");

function render(layout = tree, onRatio = vi.fn(), onRender: ProfilerOnRenderCallback = () => {}) {
  const noop = vi.fn();
  const props = {
    visible: true,
    layout,
    sessions: ["a", "b"].map((id) => ({ ...newSession("codex", "/repo"), id, title: id })),
    editorPanes: [],
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: "a",
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onRatio,
    onMovePane: noop,
    onDetachPane: noop,
  } as unknown as ComponentProps<typeof PaneTree>;
  act(() =>
    root.render(createElement(Profiler, { id: "panes", onRender }, createElement(PaneTree, props))),
  );
}

function pointer(target: EventTarget, type: string, x: number) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: 50 });
  act(() => target.dispatchEvent(event));
}

const pane = (id: string) => container.querySelector<HTMLElement>(`[data-pane-leaf="${id}"]`)!;
const sashElement = () => container.querySelector<HTMLElement>('[role="separator"]')!;
const box = (element: HTMLElement) => [element.style.left, element.style.width];
/** Runs the animation frame the sash coalesced its pointer moves into. */
const flushFrame = () => act(() => frames.splice(0).forEach((frame) => frame(0)));

function startDrag() {
  const sash = sashElement();
  Object.assign(sash, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  vi.spyOn(pane("a").parentElement!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 400, 300),
  );
  pointer(sash, "pointerdown", 200);
  return sash;
}

describe("pane sash drag", () => {
  it("moves panes and sash without rendering, then commits once", () => {
    const onRatio = vi.fn();
    const renders = vi.fn();
    render(tree, onRatio, renders);
    const sash = startDrag();
    renders.mockClear();

    pointer(sash, "pointermove", 240);
    flushFrame();
    expect(box(pane("a"))).toEqual(["0%", "60%"]);
    expect(box(pane("b"))).toEqual(["60%", "40%"]);
    expect(sash.style.left).toBe("60%");
    pointer(sash, "pointermove", 280);
    pointer(sash, "pointermove", 300);
    flushFrame();
    expect(box(pane("a"))).toEqual(["0%", "75%"]);
    expect(pane("b").dataset.paneBackground).toBe(
      paneBackgroundPlacement({ x: 0.75, y: 0, w: 0.25, h: 1 }),
    );
    expect(renders).not.toHaveBeenCalled();
    expect(onRatio).not.toHaveBeenCalled();

    pointer(sash, "pointerup", 300);
    expect(renders).toHaveBeenCalled(); // the counter does see commits, e.g. the sash ending
    expect(onRatio).toHaveBeenCalledExactlyOnceWith(tree.id, 0, 0.75);
    expect(box(pane("a"))).toEqual(["0%", "75%"]);
  });

  it("renders the committed layout with the styles the drag wrote", () => {
    const onRatio = vi.fn();
    render(tree, onRatio);
    const sash = startDrag();
    pointer(sash, "pointermove", 280);
    flushFrame();
    pointer(sash, "pointerup", 280);
    const written = [pane("a"), pane("b"), sashElement()].map((element) => element.style.cssText);
    render(setSplitRatio(tree, tree.id, 0, 0.7), onRatio);
    expect([pane("a"), pane("b"), sashElement()].map((element) => element.style.cssText)).toEqual(
      written,
    );
    expect(layoutLeaves(setSplitRatio(tree, tree.id, 0, 0.7))[0].rect.w).toBeCloseTo(0.7);
  });

  it("restores the start layout when the drag is cancelled", () => {
    const onRatio = vi.fn();
    render(tree, onRatio);
    const sash = startDrag();
    const before = [pane("a"), pane("b"), sash].map((element) => element.style.cssText);
    pointer(sash, "pointermove", 300);
    flushFrame();
    expect(box(pane("a"))).toEqual(["0%", "75%"]);
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })),
    );
    expect([pane("a"), pane("b"), sash].map((element) => element.style.cssText)).toEqual(before);
    expect(pane("b").dataset.paneBackground).toBe(
      paneBackgroundPlacement({ x: 0.5, y: 0, w: 0.5, h: 1 }),
    );
    expect(onRatio).not.toHaveBeenCalled();
  });

  it("commits a keyboard step straight to the ratio callback", () => {
    const onRatio = vi.fn();
    render(tree, onRatio);
    act(() =>
      sashElement().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(onRatio).toHaveBeenCalledExactlyOnceWith(tree.id, 0, 0.52);
  });
});
