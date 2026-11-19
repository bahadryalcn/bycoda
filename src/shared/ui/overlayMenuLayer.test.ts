// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LAYER } from "../lib/layers";
import { ImageLightbox } from "./ImageLightbox";
import { Popover } from "./Popover";
import { Sheet } from "./Sheet";

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  anchor = document.createElement("button");
  container = document.createElement("div");
  document.body.append(anchor, container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Stacking order of every popover frame (the body-level children), in opening order. */
const popoverLayers = () =>
  [...document.body.querySelectorAll<HTMLElement>(":scope > [data-popover-side]")].map((frame) =>
    Number(frame.style.zIndex),
  );

const render = (node: ReturnType<typeof createElement>) => act(async () => root.render(node));

it("stacks a popover opened from inside another popover above its parent", async () => {
  const inner = document.createElement("button");
  document.body.append(inner);
  await render(
    createElement(Popover, { anchor }, createElement(Popover, { anchor: inner }, "Inner")),
  );
  expect(popoverLayers()).toEqual([LAYER.popover, LAYER.popover + 1]);
});

it("lifts a popover inside a toast-layer viewport sheet above it without a manual layer", async () => {
  await render(
    createElement(
      Sheet,
      { modal: false, layer: LAYER.toast, title: "Notifications", onClose: vi.fn() },
      createElement(Popover, { anchor }, "Options"),
    ),
  );
  expect(popoverLayers()).toEqual([LAYER.toast + 1]);
});

it("lifts a popover inside a default-layer viewport sheet above the dialog layer", async () => {
  await render(
    createElement(
      Sheet,
      { modal: false, title: "Panel", onClose: vi.fn() },
      createElement(Popover, { anchor }, "Menu"),
    ),
  );
  expect(popoverLayers()).toEqual([LAYER.dialogPopover]);
});

it("leaves a viewport sheet at the popover layer on the inherited floor", async () => {
  await render(
    createElement(
      Sheet,
      { modal: false, layer: LAYER.popover, title: "Panel", onClose: vi.fn() },
      createElement(Popover, { anchor }, "Menu"),
    ),
  );
  expect(popoverLayers()).toEqual([LAYER.popover]);
});

it("lifts a popover opened from the image viewer above it, outside any Modal", async () => {
  await render(
    createElement(ImageLightbox, {
      src: "photo.png",
      alt: "Preview",
      onClose: vi.fn(),
      actions: createElement(Popover, { anchor }, "Hint"),
    }),
  );
  expect(popoverLayers()).toEqual([LAYER.dialogPopover]);
});
