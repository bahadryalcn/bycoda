// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ContentCalendar } from "./ContentCalendar";
import type { CalendarEntry } from "./calendarModel";

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
