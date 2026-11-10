import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const { limits, filters } = vi.hoisted(() => ({
  filters: { provider: [] as string[], account: [] as string[], project: [], model: [], group: [] },
  limits: {
    status: "ready",
    error: null as string | null,
    session: { usedPercent: 42, windowMinutes: 300, resetsAt: null },
    weekly: null,
    monthly: null,
  },
}));
vi.mock("../../providers/model/providerAccounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/model/providerAccounts")>()),
  providerAccounts: (provider: string) => [
    { id: "default", provider, label: "Default account", color: "pink" },
  ],
  subscribeProviderAccounts: () => () => {},
}));
vi.mock("../../providers/model/rateLimitsCache", () => ({
  useCachedRateLimits: () => limits,
  loadRateLimits: vi.fn(),
}));
vi.mock("./UsageOverview", () => ({
  UsageOverview: ({
    limits,
  }: {
    limits: (filters: import("../model/usageAnalytics").UsageFilters) => import("react").ReactNode;
  }) => limits(filters),
}));
vi.mock("./GrokLimits", () => ({
  GrokLimits: () => createElement("div", null, "Grok quota"),
}));
vi.mock("./UsageActiveTime", () => ({
  UsageActiveTime: () => createElement("div", null, "Active time card"),
}));
import { UsagePage } from "./UsagePage";
import { RevealedSetting } from "../../settings/ui/settingsControls";

it("shows remaining quota and does not invent reset times", () => {
  const markup = renderToStaticMarkup(createElement(UsagePage));
  expect(markup).toContain("58%");
  expect(markup).toContain('aria-valuenow="58"');
  expect(markup).toContain("Reset time unavailable");
});

it("keeps known quota visible when refresh fails", () => {
  limits.error = "Could not refresh limits";
  const markup = renderToStaticMarkup(createElement(UsagePage));
  expect(markup).toContain("58%");
  expect(markup).toContain("Could not refresh limits");
  expect(markup).toMatch(/role="alert"[^>]*class="[^"]*usage-account-error/);
  expect(markup).toContain("Retry: Default account");
  limits.error = null;
});

it("keeps every provider account in the comparison with its own quota", () => {
  const markup = renderToStaticMarkup(createElement(UsagePage, { limitsOnly: true }));
  expect(markup).toContain('aria-label="Codex · Default account"');
  expect(markup).toContain('aria-label="Claude · Default account"');
  expect(markup.match(/class="usage-account-identity"/g)).toHaveLength(2);
  expect(markup.match(/aria-valuenow="58"/g)).toHaveLength(2);
});

it("uses account colors for limits and exposes usage preferences", () => {
  const markup = renderToStaticMarkup(createElement(UsagePage));
  expect(markup).toContain("hsl(330 70% 62%)");
  expect(markup).toContain("Account actions");
  expect(markup).not.toContain("Display preferences");
  expect(markup).toContain("Show remaining usage");
  const revealed = renderToStaticMarkup(
    createElement(
      RevealedSetting.Provider,
      { value: "show-remaining-usage" },
      createElement(UsagePage),
    ),
  );
  expect(revealed).toContain("Show remaining usage");
});

it("shows the active time card except on the limits-only page", () => {
  expect(renderToStaticMarkup(createElement(UsagePage))).toContain("Active time card");
  expect(renderToStaticMarkup(createElement(UsagePage, { limitsOnly: true }))).not.toContain(
    "Active time card",
  );
});

it("shows Grok limits only within its provider and account filters", () => {
  const markup = () => renderToStaticMarkup(createElement(UsagePage));
  try {
    expect(markup()).toContain("Grok quota");
    filters.provider = ["codex"];
    expect(markup()).not.toContain("Grok quota");
    filters.provider = ["grok"];
    filters.account = ["codex:default"];
    expect(markup()).not.toContain("Grok quota");
    filters.account = ["grok:default"];
    expect(markup()).toContain("Grok quota");
  } finally {
    filters.provider = [];
    filters.account = [];
  }
});
