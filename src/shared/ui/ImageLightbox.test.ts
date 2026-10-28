// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageLightbox } from "./ImageLightbox";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const open = (onClose = vi.fn()) =>
  act(async () =>
    root.render(createElement(ImageLightbox, { src: "photo.png", alt: "Preview", onClose })),
  );
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.getAttribute("aria-label") === name || el.textContent === name,
  )!;

it("offers zoom controls in view mode and disables reset at fit", async () => {
  await open();
  expect(button("Zoom in")).toBeTruthy();
  expect(button("Zoom out")).toBeTruthy();
  expect(button("Reset zoom").disabled).toBe(true);
  await act(async () => button("Zoom in").click());
  expect(button("Reset zoom").disabled).toBe(false);
  await act(async () => button("Reset zoom").click());
  expect(button("Reset zoom").disabled).toBe(true);
});

it("recovers from a failed image through Retry and moves focus to it", async () => {
  await open();
  const image = document.querySelector("img")!;
  await act(async () => image.dispatchEvent(new Event("error")));
  const alert = document.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Preview unavailable");
  expect(document.activeElement).toBe(button("Retry"));
  expect(document.querySelector('[aria-label="Zoom in"]')).toBeNull();
  await act(async () => button("Retry").click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector("img")).not.toBeNull();
});

it("names the image and keeps the compare picker out of the tab order", async () => {
  await open();
  expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe(
    "Image preview: Preview",
  );
  const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(picker.tabIndex).toBe(-1);
  expect(picker.getAttribute("aria-hidden")).toBe("true");
});
