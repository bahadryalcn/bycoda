// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveDecorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";
import { ParticleText } from "./ParticleText";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 42),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    scale: vi.fn(),
    measureText: () => ({ width: 30 }),
    fillText: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(100 * 20 * 4) }),
  } as unknown as CanvasRenderingContext2D);
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

function render(text: string) {
  act(() => root.render(createElement(ParticleText, { text })));
}

it("updates the title without allocating a canvas when decorative motion is disabled", () => {
  saveDecorativeMotionEnabled(false);
  render("Original title");
  render("Updated title");
  expect(container.textContent).toBe("Updated title");
  expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});

it("uses a restrained transition and removes it live when motion is turned off", () => {
  saveDecorativeMotionEnabled(true);
  render("Original title");
  render("Updated title");
  expect(container.querySelector(".bycoda-title-settle")).not.toBeNull();
  expect(container.querySelector("canvas")).toBeNull();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  act(() => saveDecorativeMotionEnabled(false));
  expect(container.querySelector(".bycoda-title-settle")).toBeNull();
  expect(container.querySelector("canvas")).toBeNull();
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  expect(container.textContent).toBe("Updated title");
  expect(container.querySelector("span span")?.getAttribute("style") ?? "").not.toContain(
    "linear-gradient",
  );
  act(() => saveDecorativeMotionEnabled(true));
  expect(container.querySelector(".bycoda-title-settle")).not.toBeNull();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
