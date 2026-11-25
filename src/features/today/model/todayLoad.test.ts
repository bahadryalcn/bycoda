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
const mocks = vi.hoisted(() => ({
  prices: vi.fn(async () => ({ models: [] })),
  failAccount: true,
}));
vi.mock("../../providers/public/providerUsage", () => ({
  createUsagePricing: () => ({}),
  fetchModelPrices: mocks.prices,
  fetchProviderUsage: async (_provider: string, id: string) => {
    if (id === "b" && mocks.failAccount) throw new Error("unreadable");
    return { rows: [] };
  },
}));

import { fetchTodaySources, type TodaySources } from "./todayLoad";

const row = { project: "p" } as unknown as TodaySources["usage"][number]["rows"][number];
const earlier = (since: number): TodaySources => ({
  usage: [{ account: accounts[1]!, rows: [row] }] as unknown as TodaySources["usage"],
  turns: [],
  pricing: { earlier: true } as unknown as TodaySources["pricing"],
  at: 1,
  since,
});

describe("fetchTodaySources", () => {
  it("reports a price read failure and retains previous pricing", async () => {
    mocks.failAccount = false;
    mocks.prices.mockRejectedValueOnce(new Error("prices unavailable"));
    const previous = earlier(0);
    const { value, failed } = await fetchTodaySources("today", previous);
    expect(failed).toBe(true);
    expect(value.pricing).toBe(previous.pricing);
    mocks.failAccount = true;
  });
  it("keeps the earlier rows of an account that cannot be read now", async () => {
    const { value, failed } = await fetchTodaySources("today", earlier(0));
    expect(failed).toBe(true);
    expect(value.usage.find((entry) => entry.account.id === "b")?.rows).toEqual([row]);
    expect(value.usage.find((entry) => entry.account.id === "a")?.rows).toEqual([]);
    expect(value.since).toBeGreaterThan(0);
  });

  it("does not reuse earlier rows that start after the window it needs", async () => {
    const { value } = await fetchTodaySources("today", earlier(Number.MAX_SAFE_INTEGER));
    expect(value.usage.find((entry) => entry.account.id === "b")?.rows).toEqual([]);
  });

  it("reports failure when only some provider accounts could not be read", async () => {
    const { failed } = await fetchTodaySources("today");
    expect(failed).toBe(true);
  });
});
