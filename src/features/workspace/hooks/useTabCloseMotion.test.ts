// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTabCloseMotion } from "./useTabCloseMotion";

const motion = vi.hoisted(() => ({ enabled: true }));
const resize = vi.hoisted(() => ({
  listeners: new Map<Element, () => void>(),
  unsubscribe: vi.fn(),
}));

vi.mock("../../../shared/lib/observeResize", () => ({
  observeResize: (element: Element, listener: () => void) => {
    resize.listeners.set(element, listener);
    return () => {
      resize.listeners.delete(element);
      resize.unsubscribe(element);
    };
  },
}));
vi.mock("../../settings/model/settings", () => ({
  loadTabAnimationsEnabled: () => motion.enabled,
}));
vi.mock("../../settings/public/decorativeMotion", () => ({
  prefersReducedMotion: () => false,
}));

let root: Root | null = null;
let width = 120;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion.enabled = true;
  width = 120;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        width,
        height: 24,
        top: 0,
        left: 0,
        right: width,
        bottom: 24,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect,
  );
  // Regression guard: tabs must not construct their own observer.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor() {
        throw new Error("per-tab ResizeObserver");
      }
    },
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  resize.listeners.clear();
  resize.unsubscribe.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Tabs({ ids }: { ids: string[] }) {
  const { displayed, tabRef } = useTabCloseMotion(ids.map((id) => ({ id })));
  return createElement(
    "div",
    null,
    displayed.map((entry) =>
      createElement(
        "span",
        { key: entry.id, ref: tabRef(entry.id), "data-width": String(entry.width) },
        entry.id,
      ),
    ),
  );
}

function mount(ids: string[]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Tabs, { ids })));
  return container;
}

function rerender(ids: string[]) {
  act(() => root?.render(createElement(Tabs, { ids })));
}

function tab(container: HTMLElement, id: string) {
  const node = [...container.querySelectorAll("span")].find((span) => span.textContent === id);
  if (!node) throw new Error(`tab ${id} not rendered`);
  return node;
}

it("subscribes every tab through observeResize", () => {
  const container = mount(["a", "b"]);
  expect(resize.listeners.get(tab(container, "a"))).toBeTypeOf("function");
  expect(resize.listeners.get(tab(container, "b"))).toBeTypeOf("function");
});

it("releases a removed tab's subscription and keeps the others until unmount", () => {
  motion.enabled = false;
  const container = mount(["a", "b"]);
  const a = tab(container, "a");
  const b = tab(container, "b");
  rerender(["b"]);
  expect(resize.unsubscribe).toHaveBeenCalledWith(a);
  expect(resize.listeners.has(b)).toBe(true);
  act(() => root?.unmount());
  root = null;
  expect(resize.unsubscribe).toHaveBeenCalledWith(b);
});

it("re-measures through the shared subscription so a closing tab keeps its last width", () => {
  const container = mount(["a", "b"]);
  width = 200;
  act(() => resize.listeners.get(tab(container, "a"))?.());
  rerender(["b"]);
  expect(tab(container, "a").dataset.width).toBe("200");
});
