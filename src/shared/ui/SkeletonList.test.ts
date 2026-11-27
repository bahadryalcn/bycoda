// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../hooks/useDelayedVisible";
import { SkeletonList, skeletonSpread } from "./SkeletonList";

async function render(props: Parameters<typeof SkeletonList>[0]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(SkeletonList, props)));
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    },
  };
}

it("spreads widths deterministically inside the requested range", () => {
  const widths = Array.from({ length: 40 }, (_, slot) => skeletonSpread(3, slot, 28, 52));
  expect(widths.every((width) => width >= 28 && width <= 52)).toBe(true);
  expect(new Set(widths).size).toBeGreaterThan(5);
  expect(skeletonSpread(3, 7, 28, 52)).toBe(skeletonSpread(3, 7, 28, 52));
  expect(skeletonSpread(4, 7, 0, 1000)).not.toBe(skeletonSpread(3, 7, 0, 1000));
});

it("splits rows over groups with a heading and frame each, and stays decorative without a label", async () => {
  const { container, unmount } = await render({
    rows: 7,
    groups: 2,
    heading: true,
    framed: true,
    leading: "icon",
    trailing: "switch",
  });
  try {
    const frames = container.querySelectorAll("[data-framed]");
    expect(frames).toHaveLength(2);
    expect(frames[0]!.children).toHaveLength(4);
    expect(frames[1]!.children).toHaveLength(3);
    expect(container.querySelectorAll('[data-shape="square"]')).toHaveLength(7);
    expect(container.querySelectorAll('[data-shape="pill"]')).toHaveLength(7);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  } finally {
    await unmount();
  }
});

it("owns one delayed busy status when labelled", async () => {
  vi.useFakeTimers();
  const { container, unmount } = await render({ rows: 3, label: "Loading accounts" });
  try {
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS));
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.getAttribute("aria-label")).toBe("Loading accounts");
  } finally {
    await unmount();
    vi.useRealTimers();
  }
});
