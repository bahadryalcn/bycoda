// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { reachWhenClipped } from "./crewLabelFocus";

let root: Root;
let container: HTMLDivElement;
let scrollWidth = 0;
let resize: ResizeObserverCallback = () => {};
const disconnect = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  scrollWidth = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => scrollWidth);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(20);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const clippedLabel = (text = "A very long assigned agent name") => {
  const label = document.createElement("span");
  label.style.overflow = "clip";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  label.textContent = text;
  container.append(label);
  return label;
};

it("makes only a clipped label reachable and hit-testable", () => {
  const fits = clippedLabel("Lead");
  const stopFits = reachWhenClipped(fits);
  expect(fits.hasAttribute("tabindex")).toBe(false);
  expect(fits.hasAttribute("data-clipped")).toBe(false);
  scrollWidth = 400;
  const clipped = clippedLabel();
  const stopClipped = reachWhenClipped(clipped);
  expect(clipped.tabIndex).toBe(0);
  expect(clipped.dataset.clipped).toBe("true");
  stopFits?.();
  stopClipped?.();
});

it("follows resizes and text changes, and cleans up on release", async () => {
  scrollWidth = 400;
  const label = clippedLabel();
  const stop = reachWhenClipped(label);
  expect(label.tabIndex).toBe(0);
  scrollWidth = 100;
  await act(async () => {
    label.textContent = "Lead";
    await Promise.resolve();
  });
  expect(label.hasAttribute("tabindex")).toBe(false);
  expect(label.hasAttribute("data-clipped")).toBe(false);
  scrollWidth = 400;
  // The window-wide observer delivers by target element.
  act(() => resize([{ target: label } as ResizeObserverEntry], {} as ResizeObserver));
  expect(label.dataset.clipped).toBe("true");
  stop?.();
  expect(label.hasAttribute("tabindex")).toBe(false);
  expect(label.hasAttribute("data-clipped")).toBe(false);
  expect(reachWhenClipped(null)).toBeUndefined();
});

it("opens the shared tooltip with the full label from keyboard focus only when clipped", () => {
  scrollWidth = 400;
  act(() =>
    root.render(
      createElement(
        OverflowTooltip,
        { label: "Designer · Subagent · Context: 70%" },
        createElement(
          "span",
          {
            ref: reachWhenClipped,
            "data-testid": "label",
            style: { overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap" },
          },
          "Designer",
        ),
      ),
    ),
  );
  const label = container.querySelector('[data-testid="label"]') as HTMLElement;
  expect(label.tabIndex).toBe(0);
  vi.spyOn(label, "matches").mockReturnValue(true);
  act(() => label.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Designer · Subagent · Context: 70%",
  );
  act(() => label.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("never opens the tooltip for a label that is fully visible", () => {
  scrollWidth = 100;
  act(() =>
    root.render(
      createElement(
        OverflowTooltip,
        { label: "Lead" },
        createElement(
          "span",
          {
            ref: reachWhenClipped,
            "data-testid": "label",
            style: { overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap" },
          },
          "Lead",
        ),
      ),
    ),
  );
  const label = container.querySelector('[data-testid="label"]') as HTMLElement;
  expect(label.hasAttribute("tabindex")).toBe(false);
  act(() => label.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
  act(() => vi.advanceTimersByTime(1000));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
