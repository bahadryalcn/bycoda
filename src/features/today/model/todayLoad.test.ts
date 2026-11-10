import { describe, expect, it, vi } from "vitest";

const accounts = [
  { provider: "claude", id: "a" },
  { provider: "claude", id: "b" },
];

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => ({ turns: [] }) }));
vi.mock("../../providers/public/providerAccounts", () => ({
  PROVIDER_ACCOUNT_PROVIDERS: ["claude"],
  providerAccounts: () => accounts,
}));
vi.mock("../../providers/public/providerUsage", () => ({
  createUsagePricing: () => ({}),
  fetchModelPrices: async () => ({ models: [] }),
  fetchProviderUsage: async (_provider: string, id: string) => {
    if (id === "b") throw new Error("unreadable");
    return { rows: [] };
  },
}));

import { fetchTodaySources } from "./todayLoad";

describe("fetchTodaySources", () => {
  it("reports failure when only some provider accounts could not be read", async () => {
    const { failed } = await fetchTodaySources("today");
    expect(failed).toBe(true);
  });
});
