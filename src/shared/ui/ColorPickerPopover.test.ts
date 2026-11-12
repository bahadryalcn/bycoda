// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ColorPickerPopover, ColorSwatchRow } from "./ColorPickerPopover";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

it("keeps partial hex input editable and only publishes complete colors", () => {
  const onChange = vi.fn();
  act(() => root.render(createElement(ColorPickerPopover, { value: "#ff0000", onChange })));
  const input = container.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (const draft of ["", "#1", "#12", "#123456"]) {
    act(() => {
      setter.call(input, draft);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe(draft);
  }
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#123456");
});

it("exposes keyboard sliders and publishes once under StrictMode", () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(ColorPickerPopover, { value: "#ff0000", onChange }),
      ),
    ),
  );
  const hue = container.querySelector<HTMLElement>('[aria-label="Hue"]')!;
  const saturation = container.querySelector<HTMLElement>(
    '[aria-label="Saturation and brightness"]',
  )!;
  expect(hue.tabIndex).toBe(0);
  expect(saturation.tabIndex).toBe(0);
  act(() => {
    hue.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }),
    );
  });
  expect(hue.getAttribute("aria-valuenow")).toBe("10");
  expect(onChange).toHaveBeenCalledTimes(1);
  act(() => {
    saturation.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  expect(saturation.getAttribute("aria-valuenow")).toBe("99");
  expect(onChange).toHaveBeenCalledTimes(2);
});

it("releases a drag when its owning picker unmounts", () => {
  const onChange = vi.fn();
  act(() => root.render(createElement(ColorPickerPopover, { value: "#ff0000", onChange })));
  const hue = container.querySelector<HTMLElement>('[aria-label="Hue"]')!;
  hue.setPointerCapture = vi.fn();
  vi.spyOn(hue, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 20,
  } as DOMRect);
  act(() => {
    hue.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 25, bubbles: true }),
    );
  });
  expect(onChange).toHaveBeenCalledOnce();
  act(() => root.render(null));
  act(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 75 }));
  });
  expect(onChange).toHaveBeenCalledOnce();
});

it("marks the chosen swatch with a pressed state and a check glyph, not colour alone", () => {
  const pick = vi.fn();
  act(() =>
    root.render(
      createElement(ColorSwatchRow, {
        colors: ["#ff0000", "#00ff00", "#0000ff"],
        labels: ["Red", "Green", "Blue"],
        colorIndex: 1,
        customColor: null,
        customPickerOpen: false,
        onPickIndex: pick,
      }),
    ),
  );
  const swatch = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(swatch("Green").getAttribute("aria-pressed")).toBe("true");
  expect(swatch("Green").hasAttribute("title")).toBe(false);
  expect(swatch("Green").hasAttribute("data-tooltip-owner")).toBe(true);
  expect(swatch("Green").querySelector("svg")).not.toBeNull();
  expect(swatch("Red").getAttribute("aria-pressed")).toBe("false");
  expect(swatch("Red").querySelector("svg")).toBeNull();
  act(() => swatch("Blue").click());
  expect(pick).toHaveBeenCalledExactlyOnceWith(2);
});

it("highlights the custom colour control while its picker is open and keeps the eyedropper glyph", () => {
  act(() =>
    root.render(
      createElement(ColorSwatchRow, {
        colors: ["#ff0000"],
        colorIndex: 0,
        customColor: null,
        customPickerOpen: true,
        onPickIndex: vi.fn(),
        onToggleCustom: vi.fn(),
      }),
    ),
  );
  const custom = container.querySelector<HTMLButtonElement>('button[aria-label="Custom color"]')!;
  expect(custom.getAttribute("aria-expanded")).toBe("true");
  expect(custom.hasAttribute("title")).toBe(false);
  expect(custom.hasAttribute("data-tooltip-owner")).toBe(true);
  expect(custom.hasAttribute("data-selected")).toBe(true);
  expect(custom.querySelector("svg")).not.toBeNull();
});
