// @vitest-environment happy-dom
import { act, createElement, startTransition, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lazySurface } from "../../shared/ui/lazySurface";
import { NavigationBoundary } from "./NavigationBoundary";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([true, false])(
  "keeps navigation usable during a stalled Tasks import (transition: %s)",
  async (transition) => {
    let finish!: (module: { default: () => ReturnType<typeof createElement> }) => void;
    const Tasks = lazySurface(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      { suspense: false },
    );
    function Workspace() {
      const [open, setOpen] = useState(false);
      const [tick, setTick] = useState(0);
      return createElement(
        "div",
        { "data-workspace": true },
        createElement(
          "button",
          {
            onClick: () => (transition ? startTransition(() => setOpen(true)) : setOpen(true)),
          },
          "Tasks",
        ),
        createElement("button", { onClick: () => setTick(tick + 1) }, `Session update ${tick}`),
        open
          ? createElement(NavigationBoundary, {
              name: "Tasks",
              onBack: () => setOpen(false),
              children: createElement(Tasks),
            })
          : createElement("main", null, "Workspace content"),
      );
    }
    await act(async () =>
      root.render(
        createElement(Suspense, { fallback: "Whole workspace hidden" }, createElement(Workspace)),
      ),
    );
    await act(async () => container.querySelector("button")!.click());
    await act(async () => container.querySelectorAll("button")[1]!.click());
    expect(container.querySelector<HTMLElement>("[data-workspace]")!.style.display).not.toBe(
      "none",
    );
    expect(container.textContent).toContain("Loading Tasks");
    expect(container.textContent).not.toContain("Whole workspace hidden");
    await act(async () => container.querySelectorAll("button")[2]!.click());
    expect(container.textContent).toContain("Workspace content");
    await act(async () => finish({ default: () => createElement("main", null, "Task board") }));
    expect(container.textContent).not.toContain("Task board");
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Task board");
  },
);

it("explains a slow load and clears its timer when the page arrives", async () => {
  vi.useFakeTimers();
  let finish!: (module: { default: () => ReturnType<typeof createElement> }) => void;
  const Tasks = lazySurface(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    { suspense: false },
  );
  await act(async () =>
    root.render(
      createElement(NavigationBoundary, {
        name: "Tasks",
        onBack: vi.fn(),
        children: createElement(Tasks),
      }),
    ),
  );
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(container.textContent).toContain("taking longer to load");
  await act(async () => finish({ default: () => createElement("main", null, "Task board") }));
  expect(container.textContent).toBe("Task board");
  expect(vi.getTimerCount()).toBe(0);
});
