// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPane, LayoutNode } from "../model/layout";
import { PaneTree } from "./PaneTree";

vi.mock("../../files/ui/FilePane", async () => {
  const { createElement } = await import("react");
  return {
    FilePane: ({ pane }: { pane: EditorPane }) =>
      createElement("div", { "data-file-pane": pane.id }),
  };
});

vi.mock("../../sessions/ui/SessionPane", () => ({ SessionPane: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });

function split(dir: "right" | "down", ...children: LayoutNode[]): LayoutNode {
  return {
    type: "split",
    id: `split-${dir}`,
    dir,
    children,
    sizes: children.map(() => 1 / children.length),
  };
}

function render(layout: LayoutNode, ids: string[]) {
  const noop = vi.fn();
  const props: ComponentProps<typeof PaneTree> = {
    visible: true,
    layout,
    sessions: [],
    editorPanes: ids.map((id) => ({ id, files: [], activeFileId: "" })),
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: ids[0],
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onCloseOtherFiles: noop,
    onReorderFiles: noop,
    onFileDirtyChange: noop,
    onFileErrorCountChange: noop,
    onRatio: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: noop,
    onStop: noop,
    onCompactContext: noop,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
    onMovePane: noop,
    onDetachPane: noop,
    onNewTerminal: noop,
  };
  act(() => root.render(createElement(PaneTree, props)));
}

function enterFrom(id: string) {
  return container
    .querySelector(`[data-file-pane="${id}"]`)
    ?.closest("[data-pane-enter]")
    ?.getAttribute("data-pane-enter");
}

describe("pane enter animation", () => {
  it("leaves panes alone on mount", () => {
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    expect(container.querySelector("[data-pane-enter]")).toBeNull();
  });

  it("slides a new pane in from the edge it was split on", () => {
    render(leaf("a"), ["a"]);
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    expect(enterFrom("a")).toBeUndefined();
    expect(enterFrom("b")).toBe("right");

    render(split("right", leaf("a"), split("down", leaf("b"), leaf("c"))), ["a", "b", "c"]);
    expect(enterFrom("c")).toBe("bottom");
  });

  it("clears the animation once it finishes", () => {
    render(leaf("a"), ["a"]);
    render(split("right", leaf("b"), leaf("a")), ["a", "b"]);
    const pane = container.querySelector('[data-file-pane="b"]')!.closest("[data-pane-enter]")!;
    expect(pane.getAttribute("data-pane-enter")).toBe("left");

    const event = new Event("animationend", { bubbles: true });
    Object.assign(event, { animationName: "pane-enter" });
    act(() => pane.dispatchEvent(event));
    expect(container.querySelector("[data-pane-enter]")).toBeNull();
  });

  it("undoes focus scrolling while the pane slides in", () => {
    render(leaf("a"), ["a"]);
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    const box = container
      .querySelector('[data-file-pane="b"]')!
      .closest<HTMLElement>("[data-pane-id]")!;
    box.scrollLeft = 300;
    act(() => box.dispatchEvent(new Event("scroll")));
    expect(box.scrollLeft).toBe(0);
  });

  it("does not animate a pane swapped in place", () => {
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    render(split("right", leaf("a"), leaf("c")), ["a", "c"]);
    expect(container.querySelector("[data-pane-enter]")).toBeNull();
  });
});

it("skips pane entry with reduced motion and does not schedule cleanup", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  render(leaf("a"), ["a"]);
  render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
  expect(container.querySelector("[data-pane-enter]")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("clears entry on its bounded timer when no animation event arrives", () => {
  render(leaf("a"), ["a"]);
  render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
  expect(enterFrom("b")).toBe("right");
  act(() => vi.advanceTimersByTime(320));
  expect(container.querySelector("[data-pane-enter]")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  const box = container
    .querySelector('[data-file-pane="b"]')!
    .closest<HTMLElement>("[data-pane-id]")!;
  box.scrollLeft = 50;
  act(() => box.dispatchEvent(new Event("scroll")));
  expect(box.scrollLeft).toBe(50);
});

it("ignores a child's animation event and releases cleanup on unmount", () => {
  render(leaf("a"), ["a"]);
  render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
  const child = container.querySelector('[data-file-pane="b"]')!;
  const event = new Event("animationend", { bubbles: true });
  Object.assign(event, { animationName: "pane-enter" });
  act(() => child.dispatchEvent(event));
  expect(enterFrom("b")).toBe("right");
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});
