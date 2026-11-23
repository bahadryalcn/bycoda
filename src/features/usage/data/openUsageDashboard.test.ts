// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { OPEN_SETTINGS_EVENT } from "../../settings/model/settingsLink";
import { emptyUsageFilters } from "../model/usageAnalytics";
import {
  hasUsageViewIntent,
  subscribeUsageViewIntent,
  takeUsageViewIntent,
  type UsageViewIntent,
} from "../model/usageViewIntent";
import { openUsageDashboard } from "./openUsageDashboard";

const intent: UsageViewIntent = {
  preset: "custom",
  window: { start: 1, end: 2 },
  filters: { ...emptyUsageFilters(), project: ["/p"] },
  metric: "cost",
  resolution: "day",
};
const quick = { navigationMs: 40, applyMs: 40 };
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  document.body.replaceChildren();
  takeUsageViewIntent();
});

/** Stands in for the workspace's settings opener, which shows the Usage page. */
function settingsOpens(visible = true) {
  const opened: unknown[] = [];
  const listener = (event: Event) => {
    opened.push((event as CustomEvent).detail);
    if (!visible) return;
    const page = document.createElement("div");
    page.dataset.settingsSection = "usage";
    page.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.append(page);
  };
  window.addEventListener(OPEN_SETTINGS_EVENT, listener);
  cleanup.push(() => window.removeEventListener(OPEN_SETTINGS_EVENT, listener));
  return opened;
}

it("opens Settings, Usage by the workspace opener and applies the settings after it is visible", async () => {
  const opened = settingsOpens();
  const seen: UsageViewIntent[] = [];
  // A mounted dashboard takes the intent as soon as it is published.
  cleanup.push(
    subscribeUsageViewIntent(() => {
      const taken = takeUsageViewIntent();
      if (taken) seen.push(taken);
    }),
  );
  await expect(openUsageDashboard(intent, quick)).resolves.toEqual({ filtersApplied: true });
  expect(opened).toEqual(["usage"]);
  expect(seen).toEqual([intent]);
});

it("publishes nothing when the page never opens", async () => {
  settingsOpens(false);
  await expect(openUsageDashboard(intent, quick)).rejects.toThrow("did not open");
  expect(hasUsageViewIntent()).toBe(false);
});

it("drops settings the dashboard did not take, so a later visit starts clean", async () => {
  settingsOpens();
  await expect(openUsageDashboard(intent, quick)).resolves.toEqual({ filtersApplied: false });
  expect(hasUsageViewIntent()).toBe(false);
  expect(takeUsageViewIntent()).toBeNull();
});
