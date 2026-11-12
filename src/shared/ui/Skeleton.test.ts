// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../hooks/useDelayedVisible";
import { Skeleton, SkeletonBar } from "./Skeleton";

it("keeps held block placeholders silent until the shared loading delay", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Skeleton, { label: "Loading items" })));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Loading items",
    );
    await act(async () =>
      root.render(createElement(Skeleton, { label: "Loading items", "aria-hidden": true })),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("shares the Arc shape primitive across block, inline and composed placeholders", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Skeleton, { delay: false }),
          createElement(Skeleton, { delay: false, inline: true }),
          createElement(SkeletonBar),
        ),
      ),
    );
    const line = container.querySelector('[role="status"] span span')!;
    const inline = container.querySelector('span[role="status"]')!;
    const bar = container.querySelector('[data-shape="bar"]')!;
    expect(
      [...line.classList].some(
        (name) => inline.classList.contains(name) && bar.classList.contains(name),
      ),
    ).toBe(true);
    expect(bar.getAttribute("aria-hidden")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("announces a custom layout once and keeps its shapes decorative", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(Skeleton, {
          delay: false,
          label: "Loading settings",
          placeholder: createElement(SkeletonBar),
        }),
      ),
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-shape="bar"]')?.closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
