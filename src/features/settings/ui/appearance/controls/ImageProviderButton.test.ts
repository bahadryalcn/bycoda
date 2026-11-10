// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HARNESS_ICONS } from "../../../../../shared/ui/identity/HarnessIcon";
import { ImageProviderButton, type ImageProviderChoice } from "./ImageProviderButton";

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();
function Harness() {
  const [value, setValue] = useState<ImageProviderChoice>("none");
  return createElement(ImageProviderButton, {
    value,
    onChange: (next) => {
      changed(next);
      setValue(next);
    },
  });
}
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
async function open() {
  await act(async () => {
    trigger().focus();
    trigger().click();
  });
}
async function pick(label: string) {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(`[role="menuitemradio"][aria-label="${label}"]`)!
      .click(),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  changed.mockClear();
  vi.unstubAllGlobals();
});

it("selects either image provider, updates its icon, and disables generation with None", async () => {
  expect(trigger().getAttribute("aria-label")).toBe("Background image: None");
  expect(trigger().querySelector("svg")).not.toBeNull();
  await open();
  expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
  expect(document.querySelector('[aria-label="None"][aria-checked="true"]')).not.toBeNull();
  await pick("Codex");
  expect(changed).toHaveBeenLastCalledWith("codex");
  expect(trigger().getAttribute("aria-label")).toBe("Background image: Codex");
  expect(trigger().querySelector("img")?.getAttribute("src")).toBe(HARNESS_ICONS.codex);
  expect(document.activeElement).toBe(trigger());
  await open();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Codex");
  await pick("Gemini");
  expect(changed).toHaveBeenLastCalledWith("gemini");
  expect(trigger().getAttribute("aria-label")).toBe("Background image: Gemini");
  expect(trigger().querySelector("img")).toBeNull();
  expect(trigger().querySelector("svg")).not.toBeNull();
  await open();
  expect(document.querySelector('[aria-label="Gemini"][aria-checked="true"]')).not.toBeNull();
  await pick("None");
  expect(changed).toHaveBeenLastCalledWith("none");
  expect(trigger().getAttribute("aria-pressed")).toBe("false");
  expect(trigger().getAttribute("aria-label")).toBe("Background image: None");
});

it("keeps keyboard navigation and returns focus on Escape without changing provider", async () => {
  await open();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("None");
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Codex");
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger());
  expect(changed).not.toHaveBeenCalled();
});
