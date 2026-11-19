import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({
  failed: false,
  loadedPeriod: "today" as "today" | "week",
  refreshing: false,
  sessions: 0,
}));
vi.mock("../hooks/useTodayData", () => ({
  useTodayData: () => ({
    data: {
      period: read.loadedPeriod,
      totals: { sessions: read.sessions, cost: 0, runMs: 0, unpricedTokens: 0 },
      projects: [],
      days: [],
      window: { start: 0, end: 1 },
    },
    loadedPeriod: read.loadedPeriod,
    pricing: null,
    loading: false,
    refreshing: read.refreshing,
    failed: read.failed,
    updatedAt: 1,
    reload: () => {},
  }),
}));
vi.mock("../../activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../activity")>()),
  useActivityOverview: () => ({
    source: "machines",
    scope: "machines",
    setScope: () => {},
    canChooseScope: false,
    summary: {
      today: 42,
      week: 90,
      month: 120,
      year: 500,
      last7Days: [{ date: "2026-11-12", minutes: 207 }],
    },
    failed: false,
    machines: [],
    devices: [],
  }),
}));
import { TodayView } from "./TodayView";

it("explains an empty day beside the active-time stat when the read succeeded", () => {
  read.failed = false;
  const markup = renderToStaticMarkup(createElement(TodayView));
  expect(markup).toContain("No agent activity recorded today. Start a session to see it here.");
  expect(markup).toContain("Active time");
  expect(markup).toContain("42");
  expect(markup).not.toContain("Some usage could not be read");
  expect(markup).not.toContain("Active time, last 7 days");
  expect(markup).not.toContain("3h 27m");
  expect(markup).not.toContain('data-surface-role="card"');
  expect(markup).not.toContain("Activity on this computer");
});

it("does not claim there is no activity when a read failed", () => {
  read.failed = true;
  const markup = renderToStaticMarkup(createElement(TodayView));
  expect(markup).toContain("Some usage could not be read");
  expect(markup).not.toContain("No agent activity recorded");
  expect(markup).toContain("Active time");
  read.failed = false;
});

it("shows when the figures were last read", () => {
  const markup = renderToStaticMarkup(createElement(TodayView));
  expect(markup).toContain("Updated");
});

it("aligns active time and the empty text to the loaded period while another one loads", () => {
  read.loadedPeriod = "week";
  read.refreshing = true;
  const markup = renderToStaticMarkup(createElement(TodayView));
  // The selected period is still "today"; the figures on screen are this week's.
  expect(markup).toContain("90");
  expect(markup).not.toContain(">42<");
  expect(markup).toContain("No agent activity recorded this week.");
  read.loadedPeriod = "today";
  read.refreshing = false;
});

it("keeps the previous period's figures mounted during a period refresh", () => {
  read.loadedPeriod = "week";
  read.refreshing = true;
  read.sessions = 3;
  try {
    const markup = renderToStaticMarkup(createElement(TodayView));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Agent run time");
    expect(markup).toContain(">3<");
    expect(markup).toContain(">1h 30m<");
  } finally {
    read.loadedPeriod = "today";
    read.refreshing = false;
    read.sessions = 0;
  }
});
