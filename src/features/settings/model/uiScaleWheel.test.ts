// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn(() => Promise.resolve()) }),
}));

import { saveAppearancePreferences, loadAppearancePreferences } from "./appearancePreferences";
import { loadUiScale, saveUiScale } from "./uiScale";
import { createWheelStepper, installUiScaleWheel } from "./uiScaleWheel";

// happy-dom ignores `ctrlKey` in the WheelEvent constructor.
function wheel(deltaY: number, ctrlKey = true) {
  const event = new WheelEvent("wheel", { deltaY, cancelable: true, bubbles: true });
  Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
  return event;
}

describe("createWheelStepper", () => {
  it("steps once per mouse notch and accumulates touchpad deltas", () => {
    const step = createWheelStepper();
    expect(step({ deltaY: -100, deltaMode: 0 })).toBe(1);
    expect(step({ deltaY: 100, deltaMode: 0 })).toBe(-1);
    expect(step({ deltaY: -40, deltaMode: 0 })).toBe(0);
    expect(step({ deltaY: -40, deltaMode: 0 })).toBe(0);
    expect(step({ deltaY: -40, deltaMode: 0 })).toBe(1);
  });

  it("drops a partial delta when the direction reverses", () => {
    const step = createWheelStepper();
    expect(step({ deltaY: -90, deltaMode: 0 })).toBe(0);
    expect(step({ deltaY: 20, deltaMode: 0 })).toBe(0);
    expect(step({ deltaY: -20, deltaMode: 0 })).toBe(0);
  });

  it("scales line and page deltas", () => {
    const step = createWheelStepper();
    expect(step({ deltaY: -3, deltaMode: 1 })).toBe(0);
    expect(step({ deltaY: -4, deltaMode: 1 })).toBe(1);
    expect(step({ deltaY: 1, deltaMode: 2 })).toBe(-1);
  });
});

describe("installUiScaleWheel", () => {
  let detach: () => void;
  beforeEach(() => {
    localStorage.clear();
    saveUiScale(1);
    detach = installUiScaleWheel(window);
  });
  afterEach(() => detach());

  it("zooms the interface on Ctrl+wheel", () => {
    const event = wheel(-100);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(loadUiScale()).toBe(1.1);
  });

  it("leaves a wheel that a viewer already handled", () => {
    const target = document.createElement("div");
    document.body.append(target);
    target.addEventListener("wheel", (event) => event.preventDefault());
    target.dispatchEvent(wheel(-100));
    expect(loadUiScale()).toBe(1);
    target.remove();
  });

  it("ignores plain wheels", () => {
    const event = wheel(-100, false);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(loadUiScale()).toBe(1);
  });

  it("does nothing when the preference is off", () => {
    saveAppearancePreferences({ ...loadAppearancePreferences(), wheelZoom: false });
    const event = wheel(-100);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(loadUiScale()).toBe(1);
  });
});
