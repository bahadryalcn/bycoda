import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../hooks/useTodayData", () => ({
  useTodayData: () => ({
    data: {
      period: "today",
      totals: { sessions: 0, cost: 0, runMs: 0, unpricedTokens: 0 },
      projects: [],
      days: [],
      window: { start: 0, end: 1 },
    },
    pricing: null,
    loading: false,
    failed: false,
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
    summary: { today: 42, week: 90, month: 120, year: 500, last7Days: [] },
    failed: false,
    machines: [],
    devices: [],
  }),
}));
import { TodayView } from "./TodayView";

it("keeps active time and its scope note when there is no agent activity", () => {
  const markup = renderToStaticMarkup(createElement(TodayView));
  expect(markup).toContain("No agent activity yet");
  expect(markup).toContain("Active time");
  expect(markup).toContain("42");
  expect(markup).toContain("This machine only");
});
