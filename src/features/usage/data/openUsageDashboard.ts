import { openSettingsSection } from "../../settings/public/settingsLink";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import {
  dropUsageViewIntent,
  hasUsageViewIntent,
  requestUsageView,
  type UsageViewIntent,
} from "../model/usageViewIntent";

const POLL_MS = 50;
const NAVIGATION_DEADLINE_MS = 3000;
const APPLY_DEADLINE_MS = 5000;

async function until(check: () => boolean, deadlineMs: number): Promise<boolean> {
  const startedAt = monotonicNow();
  while (!check()) {
    if (elapsedSince(startedAt) >= deadlineMs) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return true;
}

const usagePageVisible = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-settings-section="usage"]')).some(
    (element) => element.getClientRects().length > 0,
  );

/**
 * Opens Settings, Usage through the workspace's own settings opener (no conversation needed),
 * and only after the page is visible hands the dashboard its settings. A failed navigation
 * publishes nothing, so no filter can apply to a later visit. Resolves whether the dashboard
 * took the settings; an untaken intent is dropped.
 */
export async function openUsageDashboard(
  intent?: UsageViewIntent,
  deadlines = { navigationMs: NAVIGATION_DEADLINE_MS, applyMs: APPLY_DEADLINE_MS },
): Promise<{ filtersApplied: boolean }> {
  openSettingsSection("usage");
  if (!(await until(usagePageVisible, deadlines.navigationMs)))
    throw new Error("The Usage dashboard did not open.");
  if (!intent) return { filtersApplied: false };
  requestUsageView(intent);
  const applied = await until(() => !hasUsageViewIntent(), deadlines.applyMs);
  if (!applied) dropUsageViewIntent();
  return { filtersApplied: applied };
}
