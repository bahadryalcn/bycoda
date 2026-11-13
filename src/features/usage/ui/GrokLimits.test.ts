import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { idleRateLimits, type ProviderRateLimits } from "../../providers/model/rateLimits";
const state = vi.hoisted(() => ({ limits: null as ProviderRateLimits | null, remaining: true }));
vi.mock("../../providers/model/useRateLimitQuery", () => ({
  useRateLimitQuery: () => state.limits,
}));
vi.mock("../../providers/model/rateLimitsCache", () => ({ loadRateLimits: vi.fn() }));
vi.mock("../../settings/model/displayPrefs", () => ({
  useShowRemainingUsage: () => state.remaining,
}));
import { GrokLimits } from "./GrokLimits";

it("shows Grok weekly remaining/used values and known reset without account controls", () => {
  state.limits = {
    ...idleRateLimits("grok"),
    status: "ok",
    weekly: { usedPercent: 19, windowMinutes: 10080, resetsAt: Date.now() + 3600000 },
  };
  state.remaining = true;
  const remaining = renderToStaticMarkup(createElement(GrokLimits, { refresh: 0 }));
  expect(remaining).toContain("81%");
  expect(remaining).toContain("Weekly");
  expect(remaining).toContain("Resets in");
  expect(remaining).toContain(
    `dateTime="${new Date(state.limits.weekly!.resetsAt!).toISOString()}"`,
  );
  expect(remaining).toMatch(/<time[^>]*>[^<]+<\/time>/);
  expect(remaining).toContain('aria-label="Grok · Weekly · left"');
  expect(remaining).not.toContain("Account actions");
  state.remaining = false;
  expect(renderToStaticMarkup(createElement(GrokLimits, { refresh: 0 }))).toContain("19%");
});

it("keeps unavailable data unknown and offers retry", () => {
  state.limits = { ...idleRateLimits("grok"), status: "error", error: "Grok usage unavailable" };
  const markup = renderToStaticMarkup(createElement(GrokLimits, { refresh: 0 }));
  expect(markup).toContain("Grok usage unavailable");
  expect(markup).toContain("Retry");
  expect(markup).not.toContain('role="meter"');
});

it("localizes the window and quantity direction together", async () => {
  const { setLanguagePreference, t } = await import("../../../shared/i18n");
  state.limits = {
    ...idleRateLimits("grok"),
    status: "ok",
    weekly: { usedPercent: 19, windowMinutes: 10080, resetsAt: null },
  };
  await setLanguagePreference("tr");
  try {
    for (const remaining of [false, true]) {
      state.remaining = remaining;
      const markup = renderToStaticMarkup(createElement(GrokLimits, { refresh: 0 }));
      expect(markup).toContain(
        `aria-label="Grok · ${t("Weekly")} · ${t(remaining ? "left" : "used")}"`,
      );
      expect(markup).toContain(t("Reset time unavailable"));
      expect(markup).toContain(`aria-valuenow="${remaining ? 81 : 19}"`);
      expect(markup).not.toContain("<time");
    }
  } finally {
    state.remaining = true;
    await setLanguagePreference("en");
  }
});
