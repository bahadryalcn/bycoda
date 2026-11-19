// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ColorPickerPopover, ColorSwatchRow } from "./ColorPickerPopover";
import { setLanguagePreference } from "../i18n";

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
  const saturation = container.querySelector<HTMLElement>('[aria-label="Saturation"]')!;
  const brightness = container.querySelector<HTMLElement>('[aria-label="Brightness"]')!;
  expect(hue.tabIndex).toBe(0);
  expect(saturation.tabIndex).toBe(0);
  expect(brightness.tabIndex).toBe(0);
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
  act(() => {
    brightness.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(brightness.getAttribute("aria-valuenow")).toBe("99");
  act(() => {
    brightness.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  });
  expect(brightness.getAttribute("aria-valuenow")).toBe("0");
  expect(onChange).toHaveBeenCalledTimes(4);
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

it("localizes fallback swatch labels, keeps explicit labels and the pressed selection", async () => {
  await act(() => setLanguagePreference("tr"));
  try {
    const pick = vi.fn();
    act(() =>
      root.render(
        createElement(ColorSwatchRow, {
          colors: ["#ff0000", "#00ff00", "#0000ff"],
          labels: ["Kırmızı"],
          colorIndex: 1,
          customColor: null,
          onPickIndex: pick,
        }),
      ),
    );
    expect(container.querySelector('button[aria-label="Kırmızı"]')).not.toBeNull();
    const selected = container.querySelector<HTMLButtonElement>('button[aria-label="Renk 2"]')!;
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    const last = container.querySelector<HTMLButtonElement>('button[aria-label="Renk 3"]')!;
    expect(last.getAttribute("aria-pressed")).toBe("false");
    act(() => last.click());
    expect(pick).toHaveBeenCalledExactlyOnceWith(2);
    expect(container.querySelector('button[aria-label="Color 2"]')).toBeNull();
  } finally {
    await act(() => setLanguagePreference("en"));
  }
});
