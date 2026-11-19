// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ContentCalendar } from "./ContentCalendar";
import type { CalendarEntry } from "./calendarModel";

function renderCalendar(view: "week" | "month", anchor: number) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  act(() =>
    root.render(
      createElement(ContentCalendar, {
        view,
        anchor,
        entries: [],
        onOpen: vi.fn(),
        onPickDay: vi.fn(),
      }),
    ),
  );
  const cleanup = () => {
    act(() => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  };
  return { element, cleanup };
}

it("exposes each day as a list item named by its full date, with no region landmarks", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 13, 10));
  const { element, cleanup } = renderCalendar("month", new Date(2026, 10, 13, 10).getTime());
  try {
    expect(element.querySelectorAll("section")).toHaveLength(0);
    expect(element.querySelector('[role="list"]')).not.toBeNull();
    const items = element.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(42);
    // Month cells start on Monday 26 October 2026; 13 November is index 18.
    expect(items[18]!.getAttribute("aria-current")).toBe("date");
    expect(items[18]!.querySelector(".sr-only")!.textContent).toContain("13");
    expect(items[17]!.hasAttribute("aria-current")).toBe(false);
    // The "New post" action keeps its date label.
    expect(items[18]!.querySelector(".content-day-add")!.getAttribute("aria-label")).toContain(
      "13",
    );
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it("moves the today marker to the new day at local midnight while open", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 30));
  const { element, cleanup } = renderCalendar("week", new Date(2026, 10, 13, 12).getTime());
  try {
    const todayName = () =>
      element.querySelector('[aria-current="date"] .sr-only')?.textContent ?? "";
    expect(todayName()).toContain("13");
    act(() => vi.advanceTimersByTime(30_000));
    expect(todayName()).toContain("14");
    expect(element.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it("toggles a day's overflow with one button that keeps aria-expanded in step", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const anchor = new Date(2026, 10, 13, 10).getTime();
  const entriesFor = (count: number): CalendarEntry[] =>
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      campaignId: "campaign-" + i,
      at: anchor + i * 60000,
      status: "queued",
      accountId: "a1",
      platform: "linkedin",
      text: "Post " + i,
    }));
  const render = (count: number) =>
    act(() =>
      root.render(
        createElement(ContentCalendar, {
          view: "month",
          anchor,
          entries: entriesFor(count),
          onOpen: vi.fn(),
          onPickDay: vi.fn(),
        }),
      ),
    );
  const toggle = () => element.querySelector<HTMLButtonElement>("[aria-expanded]");
  try {
    render(5);
    const button = toggle();
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("2 more");
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    act(() => button!.click());
    expect(toggle()).toBe(button);
    expect(button!.isConnected).toBe(true);
    expect(button!.textContent).toBe("Show less");
    expect(button!.getAttribute("aria-expanded")).toBe("true");
    expect(button!.getAttribute("aria-label")).toContain("Show fewer posts on");
    expect(element.querySelectorAll(".content-entry")).toHaveLength(5);
    act(() => button!.click());
    expect(toggle()).toBe(button);
    expect(button!.textContent).toBe("2 more");
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    expect(element.querySelectorAll(".content-entry")).toHaveLength(3);
    render(3);
    expect(toggle()).toBeNull();
  } finally {
    act(() => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});

it("expands all month posts and opens a previously hidden post", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const anchor = new Date(2026, 10, 13, 10).getTime();
  const entries: CalendarEntry[] = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    campaignId: "campaign-" + i,
    at: anchor + i * 60000,
    status: "queued",
    accountId: "a1",
    platform: "linkedin",
    text: "Post " + i,
  }));
  const onOpen = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(ContentCalendar, {
          view: "month",
          anchor,
          entries,
          onOpen,
          onPickDay: vi.fn(),
        }),
      ),
    );
    expect(element.querySelectorAll(".content-entry")).toHaveLength(3);
    const more = [...element.querySelectorAll("button")].find(
      (node) => node.textContent === "2 more",
    );
    expect(more).toBeDefined();
    act(() => more!.click());
    expect(element.querySelectorAll(".content-entry")).toHaveLength(5);
    act(() => element.querySelectorAll<HTMLButtonElement>(".content-entry")[4]!.click());
    expect(onOpen).toHaveBeenCalledWith("campaign-4");
  } finally {
    act(() => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
