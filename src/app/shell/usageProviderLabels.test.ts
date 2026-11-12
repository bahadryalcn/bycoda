import { expect, it } from "vitest";
import type { ProviderRateLimits } from "../../features/providers/model/rateLimits";
import { t } from "../../shared/i18n";
import { updatedLabel, usageErrorMessage, usageWindows } from "./usageProviderLabels";

const limits = {
  provider: "codex",
  updatedAt: 1,
  session: null,
  weekly: null,
  monthly: null,
} as ProviderRateLimits;

it("preserves checked and updated labels at every time boundary", () => {
  expect(updatedLabel({ ...limits, updatedAt: 0 }, 1, t)).toBe("Rate-limit details");
  for (const [minutes, suffix] of [
    [0, "just now"],
    [59, "59m ago"],
    [60, "1h ago"],
  ] as const) {
    const now = 1 + minutes * 60_000;
    expect(updatedLabel(limits, now, t)).toBe(`Checked ${suffix}`);
    expect(
      updatedLabel({ ...limits, resetCredits: { availableCount: 0, credits: [] } }, now, t),
    ).toBe(`Updated ${suffix}`);
  }
});

it("keeps window identity and ordering and preserves error text", () => {
  const window = { usedPercent: 10, windowMinutes: 5, resetsAt: null };
  const entries = usageWindows({ ...limits, session: window, monthly: window });
  expect(entries).toEqual([
    { key: "session", window },
    { key: "monthly", window },
  ]);
  expect(entries[0].window).toBe(window);
  expect(usageErrorMessage(new Error("Exact error"), "fallback")).toBe("Exact error");
  expect(usageErrorMessage(null, "fallback")).toBe("fallback");
});
