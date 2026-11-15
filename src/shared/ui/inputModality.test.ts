// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { installInputModality } from "./inputModality";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

const keydown = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

it("starts without a modality so every focus visual stays off", () => {
  dispose = installInputModality();
  expect(document.documentElement.dataset.inputModality).toBeUndefined();
});

it("switches to keyboard on a real key and back to pointer on pointerdown", () => {
  dispose = installInputModality();
  keydown("Tab");
  expect(document.documentElement.dataset.inputModality).toBe("keyboard");
  window.dispatchEvent(new Event("pointerdown"));
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
  keydown("ArrowDown");
  expect(document.documentElement.dataset.inputModality).toBe("keyboard");
});

it("ignores modifier-only key presses", () => {
  dispose = installInputModality();
  window.dispatchEvent(new Event("pointerdown"));
  for (const key of ["Shift", "Control", "Alt", "Meta"]) keydown(key);
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
});

it("removes listeners and the attribute on dispose", () => {
  dispose = installInputModality();
  keydown("Tab");
  dispose();
  dispose = undefined;
  expect(document.documentElement.dataset.inputModality).toBeUndefined();
  keydown("Tab");
  expect(document.documentElement.dataset.inputModality).toBeUndefined();
});
