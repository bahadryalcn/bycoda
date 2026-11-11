// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../hooks/useDelayedVisible";
import { LoadingCard, SLOW_LOAD_MS } from "./LoadingCard";

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (onBack = vi.fn()) =>
  act(async () =>
    root.render(
      createElement(
        LoadingCard,
        {
          heading: "General",
          title: "Loading Settings…",
          slowDescription: "Settings is taking longer to load.",
          slowAction: createElement("button", { type: "button", onClick: onBack }, "Back"),
        },
        createElement("span", { "data-shape": true }),
      ),
    ),
  );

it("holds silently for the loading delay, then shows one status with the skeleton inside", async () => {
  await render();
  const card = node.querySelector("[data-loading-card]")!;
  expect(card.hasAttribute("data-held")).toBe(true);
  expect(node.querySelector('[role="status"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS));
  expect(card.hasAttribute("data-held")).toBe(false);
  const status = node.querySelectorAll('[role="status"]');
  expect(status).toHaveLength(1);
  expect(status[0]!.textContent).toBe("Loading Settings…");
  // Skeleton shapes live in the same card and stay hidden from assistive technology.
  expect(card.querySelector("[data-shape]")!.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(node.textContent).not.toContain("taking longer");
});

it("explains a slow load inside the same card and offers its way out", async () => {
  const onBack = vi.fn();
  await render(onBack);
  await act(async () => vi.advanceTimersByTime(SLOW_LOAD_MS));
  const card = node.querySelector("[data-loading-card]")!;
  expect(node.querySelectorAll("[data-loading-card]")).toHaveLength(1);
  expect(card.querySelector('[role="status"]')!.textContent).toContain(
    "Settings is taking longer to load.",
  );
  // The elapsed time never reads less than the wait that made the load slow.
  expect(card.textContent).toContain("3s");
  card.querySelector("button")!.click();
  expect(onBack).toHaveBeenCalledOnce();
});

it("stops its timers when the load finishes", async () => {
  await render();
  await act(async () => vi.advanceTimersByTime(SLOW_LOAD_MS));
  await act(async () => root.render(createElement("div")));
  expect(vi.getTimerCount()).toBe(0);
});
