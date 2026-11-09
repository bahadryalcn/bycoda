// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageCompare } from "./ImageCompare";

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
  container.remove();
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () =>
    root.render(
      createElement(ImageCompare, {
        before: createElement("img", { src: "before.png", alt: "Before frame" }),
        after: createElement("img", { src: "after.png", alt: "After frame" }),
      }),
    ),
  );

it("exposes one keyboard slider whose value follows arrow, Home and End keys", async () => {
  await render();
  const slider = container.querySelector<HTMLElement>('[role="slider"]')!;
  expect(slider.getAttribute("aria-valuenow")).toBe("50");
  const press = (key: string) =>
    act(async () =>
      slider.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
    );
  await press("ArrowRight");
  expect(slider.getAttribute("aria-valuenow")).toBe("49");
  await press("End");
  expect(slider.getAttribute("aria-valuenow")).toBe("100");
  await press("Home");
  expect(slider.getAttribute("aria-valuenow")).toBe("0");
});

it("replaces only the side whose image failed with a readable status and recovers on load", async () => {
  await render();
  const before = container.querySelector<HTMLImageElement>('img[alt="Before frame"]')!;
  const after = container.querySelector<HTMLImageElement>('img[alt="After frame"]')!;
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () => before.dispatchEvent(new Event("error")));
  const statuses = [...container.querySelectorAll('[role="status"]')];
  expect(statuses).toHaveLength(1);
  expect(statuses[0]!.getAttribute("data-side")).toBe("before");
  expect(statuses[0]!.textContent).toContain("Preview unavailable");
  await act(async () => after.dispatchEvent(new Event("error")));
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
  await act(async () => before.dispatchEvent(new Event("load")));
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
});

it("does not depend on a data-theme attribute for separator presentation", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync("src/shared/ui/arc/image-compare/image-compare.module.css", "utf8");
  expect(css).not.toMatch(/\[data-theme/);
});
