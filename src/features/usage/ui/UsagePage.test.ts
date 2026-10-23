import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const { limits } = vi.hoisted(() => ({
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
  }) => limits({ provider: [], account: [], project: [], model: [], group: [] }),
}));
import { UsagePage } from "./UsagePage";

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
  limits.error = null;
});

it("uses account colors for limits and exposes usage preferences", () => {
  const markup = renderToStaticMarkup(createElement(UsagePage));
  expect(markup).toContain("hsl(330 70% 62%)");
  expect(markup).toContain("Color for Default account: Pink");
  expect(markup).toContain("Show remaining usage");
});
