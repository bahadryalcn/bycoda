// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHoverCard, type HoverCardOptions } from "./HoverCard";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const trigger = () => host.querySelector<HTMLButtonElement>("button")!;
const card = () => document.querySelector<HTMLElement>("[data-hover-card]");
const scrollRegion = () => document.querySelector<HTMLElement>('[data-popover-flow="scroll"]');

function Probe({ options }: { options: HoverCardOptions }) {
  const hover = useHoverCard(options);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", ...hover.trigger }, "Subagents"),
    hover.card(
      createElement(
        "ul",
        null,
        Array.from({ length: 30 }, (_, index) => createElement("li", { key: index }, `Task ${index}`)),
      ),
    ),
  );
}

async function render(options: HoverCardOptions) {
  await act(async () => root.render(createElement(Probe, { options })));
}

async function hoverTrigger() {
  await act(async () => {
    trigger().dispatchEvent(new Event("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(400);
  });
}

// Regression for #634: the subagent hover card hid rows past its height bound and
// ignored the wheel, because it was passive and `pointer-events-none`.
it("keeps a long hover card as one scroll region that the pointer can reach", async () => {
  await render({ size: "sm", maxHeight: 320, flow: "scroll", className: "p-2.5" });
  await hoverTrigger();

  expect(card()).not.toBeNull();
  expect(scrollRegion()).not.toBeNull();
  expect(scrollRegion()!.contains(document.querySelector("ul"))).toBe(true);
  expect(card()!.classList.contains("pointer-events-none")).toBe(false);

  // Crossing the gap from the trigger into the card must not close it.
  await act(async () => {
    trigger().dispatchEvent(new Event("pointerout", { bubbles: true }));
    vi.advanceTimersByTime(50);
    card()!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(400);
  });
  expect(card()).not.toBeNull();
});

it("closes a hover card whose pointer left both the trigger and the card", async () => {
  await render({ size: "sm", maxHeight: 320, flow: "scroll" });
  await hoverTrigger();
  expect(card()).not.toBeNull();

  await act(async () => {
    trigger().dispatchEvent(new Event("pointerout", { bubbles: true }));
    vi.advanceTimersByTime(400);
  });
  expect(card()).toBeNull();
});
