// @vitest-environment happy-dom
import { act, createElement, startTransition, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../shared/i18n";
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
    const Tasks = lazySurface<object>(
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    // The route name sits in the header; the card says only that it is loading.
    expect(container.textContent).toContain("Loading…");
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
  const Tasks = lazySurface<object>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    { suspense: false },
  );
  const onBack = vi.fn();
  await act(async () =>
    root.render(
      createElement(NavigationBoundary, {
        name: "Tasks",
        onBack,
        children: createElement(Tasks),
      }),
    ),
  );
  expect(container.textContent).not.toContain("taking longer to load");
  await act(async () => vi.advanceTimersByTime(3_000));
  const card = container.querySelector("[data-loading-card]")!;
  expect(card.textContent).toContain("taking longer to load");
  const back = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Back to workspace"),
  )!;
  await act(async () => back.click());
  expect(onBack).toHaveBeenCalledOnce();
  await act(async () => finish({ default: () => createElement("main", null, "Task board") }));
  expect(container.querySelector("main")!.textContent).toBe("Task board");
  expect(vi.getTimerCount()).toBe(0);
});

it("localizes the route name in the loading header and copy", async () => {
  await setLanguagePreference("tr");
  try {
    const Tasks = lazySurface<object>(() => new Promise(() => {}), { suspense: false });
    await act(async () =>
      root.render(
        createElement(NavigationBoundary, {
          name: "Tasks",
          onBack: vi.fn(),
          children: createElement(Tasks),
        }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    expect(container.querySelector("h1")!.textContent).toBe("Görevler");
    expect(container.textContent).toContain("Yükleniyor…");
    expect(container.textContent).not.toContain("Loading…");
    expect(container.textContent).not.toContain("Tasks");
  } finally {
    await setLanguagePreference("en");
  }
});

it("names the routed screen with its one h1 and keeps inner titles below it", async () => {
  const { Heading } = await import("../../shared/ui/Heading");
  const { PaneHeader } = await import("../../shared/ui/PaneHeader");
  await act(async () =>
    root.render(
      createElement(NavigationBoundary, {
        name: "Tasks",
        onBack: vi.fn(),
        children: createElement(
          "main",
          null,
          createElement(PaneHeader, { title: "Board" }),
          createElement(Heading, { size: "page" }, "Page title"),
          createElement(Heading, { size: "section" }, "Section"),
          createElement(Heading, { size: "item" }, "Item"),
        ),
      }),
    ),
  );
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(container.querySelector("h1")!.textContent).toBe("Tasks");
  expect([...container.querySelectorAll("h2,h3,h4")].map((node) => node.tagName)).toEqual([
    "H2",
    "H2",
    "H3",
    "H4",
  ]);
});
