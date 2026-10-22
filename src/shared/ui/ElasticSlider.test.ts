// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ElasticSlider } from "./ElasticSlider";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 20),
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function key(value: string, shift = false) {
  await act(async () =>
    container.querySelector('[role="slider"]')!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
it("keeps controlled bounded keyboard values, formatted accessibility and commit callbacks", async () => {
  const commit = vi.fn();
  function Consumer() {
    const [value, setValue] = useState(40);
    return createElement(ElasticSlider, {
      label: "Opacity",
      value,
      min: 0,
      max: 100,
      step: 2,
      onValueChange: setValue,
      onValueCommit: commit,
      format: (n) => `${n}%`,
    });
  }
  await act(async () => root.render(createElement(Consumer)));
  await key("ArrowRight");
  expect(container.querySelector('[role="slider"]')!.getAttribute("aria-valuenow")).toBe("42");
  expect(commit).toHaveBeenLastCalledWith(42);
  await key("End");
  await key("ArrowRight");
  expect(commit).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="slider"]')!.getAttribute("aria-valuetext")).toBe("100%");
  await key("Home");
  await key("ArrowRight", true);
  expect(commit).toHaveBeenLastCalledWith(10);
});
it("clamps pointer gestures beyond both ends and commits released values", async () => {
  const commit = vi.fn();
  function Consumer() {
    const [value, setValue] = useState(50);
    return createElement(ElasticSlider, {
      label: "Blur",
      value,
      min: 0,
      max: 100,
      onValueChange: setValue,
      onValueCommit: commit,
    });
  }
  await act(async () => root.render(createElement(Consumer)));
  const thumb = container.querySelector('[role="slider"]')!;
  async function gesture(end: number) {
    await act(async () =>
      thumb.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          clientX: 50,
          bubbles: true,
        }),
      ),
    );
    await act(async () =>
      thumb.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX: end,
          bubbles: true,
        }),
      ),
    );
    await act(async () =>
      thumb.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX: end,
          bubbles: true,
        }),
      ),
    );
  }
  await gesture(250);
  expect(commit).toHaveBeenLastCalledWith(100);
  await gesture(-250);
  expect(commit).toHaveBeenLastCalledWith(0);
});
it("keeps disabled values unchanged and excludes disabled values from named submission", async () => {
  const change = vi.fn(),
    commit = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(ElasticSlider, {
          label: "Opacity",
          value: 35,
          name: "opacity",
          disabled: true,
          onValueChange: change,
          onValueCommit: commit,
        }),
      ),
    ),
  );
  await key("End");
  expect(change).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(container.querySelector('[role="slider"]')!.getAttribute("aria-disabled")).toBe("true");
  expect(new FormData(container.querySelector("form")!).has("opacity")).toBe(false);
});
