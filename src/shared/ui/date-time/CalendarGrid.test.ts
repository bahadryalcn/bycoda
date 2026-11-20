// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CalendarGrid } from "./CalendarGrid";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 18, 13, 7));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
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

it("gives each day button its full date only through aria-label, without a duplicate native title", async () => {
  await act(async () =>
    root.render(createElement(CalendarGrid, { value: "2026-11-18", onChange: () => {} })),
  );
  const days = [...container.querySelectorAll<HTMLButtonElement>("button[data-date]")];
  expect(days.length).toBeGreaterThanOrEqual(28);
  for (const day of days) {
    expect(day.getAttribute("aria-label")).toBeTruthy();
    expect(day.hasAttribute("title")).toBe(false);
  }
});

it("renders six week rows and only real day buttons for 4-, 5- and 6-week months", async () => {
  // Feb 2026 (4 rows Sunday-first), Nov 2026 (5 rows Sunday-first), Aug 2026 (6 rows).
  const months: [string, number][] = [
    ["2026-02-10", 28],
    ["2026-11-10", 30],
    ["2026-08-10", 31],
  ];
  for (const [value, days] of months) {
    await act(async () => root.render(createElement(CalendarGrid, { value, onChange: () => {} })));
    const rows = container.querySelectorAll('[role="grid"] [role="row"]');
    // One weekday header row plus six week rows, whatever the month needs.
    expect(rows.length).toBe(7);
    const buttons = container.querySelectorAll("button[data-date]");
    expect(buttons.length).toBe(days);
    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(42);
  }
});

it("keeps selection, roving focus and disabled state on the day button after removing title", async () => {
  await act(async () =>
    root.render(
      createElement(CalendarGrid, {
        value: "2026-11-18",
        min: "2026-11-10",
        max: "2026-11-25",
        onChange: () => {},
      }),
    ),
  );
  const selected = container.querySelector<HTMLButtonElement>('button[data-date="2026-11-18"]')!;
  expect(selected.dataset.selected).toBe("true");
  expect(selected.tabIndex).toBe(0);
  expect(selected.disabled).toBe(false);
  expect(selected.getAttribute("aria-label")).toBeTruthy();

  const outOfRange = container.querySelector<HTMLButtonElement>('button[data-date="2026-11-01"]')!;
  expect(outOfRange.disabled).toBe(true);
  expect(outOfRange.hasAttribute("title")).toBe(false);
});
