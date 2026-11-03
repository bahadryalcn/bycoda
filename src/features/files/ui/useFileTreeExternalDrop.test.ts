// @vitest-environment happy-dom
import { act, createElement, createRef, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { useFileTreeExternalDrop } from "./useFileTreeExternalDrop";

const native = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: DragDropEvent }) => void),
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (event: { payload: DragDropEvent }) => void) => {
      native.handler = handler;
      return native.stop;
    },
  }),
}));

// Directory knowledge normally comes from the loaded tree; here only "src" is a folder.
vi.mock("../model/fileTree", () => ({
  createParentOf: (cwd: string, path: string | null) =>
    !path || path === cwd
      ? cwd
      : path.endsWith("/src")
        ? path
        : path.slice(0, path.lastIndexOf("/")),
}));

let root: Root;
let container: HTMLDivElement;
let drop: ReturnType<typeof vi.fn>;
let running: { current: boolean };

const treeRef = createRef<HTMLDivElement>();

function Host() {
  const dropFilesRef = useRef(drop as (paths: string[], target: string) => Promise<void>);
  useFileTreeExternalDrop({
    cwd: "/project",
    rootRef: treeRef,
    dropFilesRef,
    setDragOverPath: vi.fn(),
    operationRunning: running,
  });
  return createElement(
    "div",
    { ref: treeRef },
    createElement("div", { role: "treeitem", title: "/project/src", "data-row": "src" }),
    createElement("div", { role: "treeitem", title: "/project/a.ts", "data-row": "a" }),
  );
}

const tree = () => treeRef.current!;
const row = (name: string) => tree().querySelector<HTMLElement>(`[data-row="${name}"]`)!;
const badge = () => document.querySelector(".pointer-drop-hint")?.textContent ?? null;
const marked = () => document.querySelector("[data-drop-indicator]");
async function emit(payload: DragDropEvent) {
  await act(async () => native.handler?.({ payload }));
}
const at = (element: Element | null) => {
  document.elementFromPoint = vi.fn(() => element);
  return { x: 10, y: 10 };
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  drop = vi.fn(async () => {});
  running = { current: false };
  native.handler = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Host)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("marks the folder under the pointer and states how many items are copied into it", async () => {
  await emit({ type: "enter", paths: ["/x/1.txt", "/x/2.txt"], position: at(row("src")) } as never);
  expect(badge()).toBe("Copy 2 items into src");
  expect(marked()).toBe(row("src"));
  expect(marked()?.getAttribute("data-drop-indicator")).toBe("inside");
  expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
  expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
    "Copy 2 items into src",
  );
});

it("targets the parent folder for a file row and the project root for empty space", async () => {
  await emit({ type: "enter", paths: ["/x/1.txt"], position: at(row("a")) } as never);
  expect(badge()).toBe("Copy 1 item into project");
  expect(marked()).toBe(tree());
  await emit({ type: "over", position: at(row("src")) } as never);
  expect(badge()).toBe("Copy 1 item into src");
  expect(marked()).toBe(row("src"));
});

it("clears the mark outside the tree, on leave, on drop, on Escape and on unmount", async () => {
  const inside = { type: "enter", paths: ["/x/1.txt"], position: at(row("src")) } as never;
  await emit(inside);
  await emit({ type: "over", position: at(document.body) } as never);
  expect(badge()).toBeNull();
  expect(marked()).toBeNull();

  await emit(inside);
  await emit({ type: "leave" } as never);
  expect(marked()).toBeNull();

  await emit(inside);
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(badge()).toBeNull();

  await emit(inside);
  await emit({ type: "drop", paths: ["/x/1.txt"], position: at(row("src")) } as never);
  expect(badge()).toBeNull();
  expect(marked()).toBeNull();
  expect(drop).toHaveBeenCalledWith(["/x/1.txt"], "/project/src");

  await emit(inside);
  act(() => root.unmount());
  expect(badge()).toBeNull();
  expect(marked()).toBeNull();
  root = createRoot(container);
});

it("blocks the target while another file operation runs", async () => {
  running.current = true;
  await emit({ type: "enter", paths: ["/x/1.txt"], position: at(row("src")) } as never);
  expect(badge()).toBe("Wait for the current file operation to finish");
  expect(marked()?.getAttribute("data-drop-indicator")).toBe("blocked");
});
