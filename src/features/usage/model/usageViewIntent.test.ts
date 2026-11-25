import { afterEach, expect, it, vi } from "vitest";
import { emptyUsageFilters } from "./usageAnalytics";
import {
  dropUsageViewIntent,
  hasUsageViewIntent,
  requestUsageView,
  subscribeUsageViewIntent,
  takeUsageViewIntent,
  usageIntentForRequest,
  USAGE_VIEW_INTENT_TTL_MS,
  type UsageViewIntent,
} from "./usageViewIntent";
import { pathKey } from "../../../shared/lib/paths";
import { usageMonthWindows, usagePresetWindow } from "./usageWindows";

const intent: UsageViewIntent = {
  preset: "custom",
  window: { start: 1, end: 2 },
  filters: { ...emptyUsageFilters(), model: ["m"] },
  metric: "tokens",
  resolution: "day",
};
afterEach(() => takeUsageViewIntent());

it("hands an intent to the dashboard once, and notifies a mounted one", () => {
  const listener = vi.fn();
  const stop = subscribeUsageViewIntent(listener);
  requestUsageView(intent, 1000);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(takeUsageViewIntent(1001)).toEqual(intent);
  expect(takeUsageViewIntent(1002)).toBeNull();
  stop();
});

it("drops an intent nobody opened in time", () => {
  requestUsageView(intent, 0);
  expect(takeUsageViewIntent(USAGE_VIEW_INTENT_TTL_MS + 1)).toBeNull();
});

it("builds local calendar months and the dashboard's 30 day window", () => {
  const now = new Date(2026, 2, 31, 10).getTime();
  const months = usageMonthWindows(now, 3);
  expect(months.map((month) => month.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  expect(months[0].window).toEqual({
    start: new Date(2026, 0, 1).getTime(),
    end: new Date(2026, 1, 1).getTime(),
  });
  expect(months[2].partial).toBe(true);
  expect(usagePresetWindow("30d", now).start).toBe(new Date(2026, 2, 2).getTime());
});

it("builds a request-only intent that skips names it cannot resolve without data", () => {
  const now = new Date(2026, 10, 23, 12).getTime();
  const { intent, skipped } = usageIntentForRequest(
    {
      period: "month-to-date",
      metric: "tokens",
      provider: "codex",
      model: "gpt",
      projectPath: "/work/app",
    },
    now,
  );
  expect(skipped).toEqual(["provider", "model"]);
  expect(intent).toMatchObject({
    preset: "custom",
    window: { start: new Date(2026, 10, 1).getTime() },
    filters: { provider: [], model: [], project: [pathKey("/work/app")] },
    metric: "tokens",
    resolution: "day",
  });
  expect(usageIntentForRequest({ period: "last-30-days", metric: "cost" }, now).skipped).toEqual(
    [],
  );
});

it("reports and drops a waiting intent", () => {
  requestUsageView(intent);
  expect(hasUsageViewIntent()).toBe(true);
  dropUsageViewIntent();
  expect(hasUsageViewIntent()).toBe(false);
  expect(takeUsageViewIntent()).toBeNull();
});
