// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ConflictLayout } from "./ConflictLayout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  localStorage.clear();
});

it("paints a pane drag on the grid and commits it to React once, on release", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
  // jsdom has no text geometry; CodeMirror measures its lines on the next frame.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const side = { text: "a\n", label: "main", origin: "test" };
  act(() =>
    root.render(
      createElement(ConflictLayout, { path: "a.txt", ours: side, theirs: side, children: null }),
    ),
  );
  const panes = host.querySelector<HTMLElement>(".conflict-layout-panes")!;
  panes.getBoundingClientRect = () => ({ width: 1000, height: 500 }) as DOMRect;
  const sash = host.querySelector<HTMLElement>('[role="separator"]')!;
  expect(panes.style.getPropertyValue("--conflict-x")).toBe("50%");
  expect(sash.getAttribute("aria-valuenow")).toBe("50");

  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
    // jsdom has no PointerEvent; the sash only needs these two fields.
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    sash.dispatchEvent(event);
  };
  act(() => {
    pointer("pointerdown", 500);
    pointer("pointermove", 600);
    vi.advanceTimersToNextFrame();
  });

  // The grid follows the pointer; the React value has not been committed yet.
  expect(panes.style.getPropertyValue("--conflict-x")).toBe("60%");
  expect(sash.getAttribute("aria-valuenow")).toBe("50");

  act(() => {
    pointer("pointerup", 600);
  });
  expect(sash.getAttribute("aria-valuenow")).toBe("60");
  expect(panes.style.getPropertyValue("--conflict-x")).toBe("60%");
  act(() => root.unmount());
});
