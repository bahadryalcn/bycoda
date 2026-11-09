import { describe, expect, it } from "vitest";
import type { UsagePricing } from "../../providers/model/providerUsage";
import type { UsageSample } from "../model/usageAnalytics";
import { searchRows, usageSampleStats } from "./usageOverviewStats";

function sample(overrides: Partial<UsageSample>): UsageSample {
  return {
    model: "m",
    tokens: 0,
    cacheRead: 0,
    priced: true,
    at: new Date(2026, 0, 1, 12).getTime(),
    ...overrides,
  } as UsageSample;
}

const pricing: UsagePricing = (model) =>
  model === "gpt" ? { input: 2, output: 8, cacheRead: 0.5 } : null;

describe("usageSampleStats", () => {
  it("summarises unpriced models, priced tokens, active days and cache savings", () => {
    const stats = usageSampleStats(
      [
        sample({ model: "gpt", tokens: 100, cacheRead: 1_000_000, priced: true }),
        sample({ model: "free", tokens: 50, priced: false, at: new Date(2026, 0, 2).getTime() }),
        sample({ model: "free", tokens: 0, priced: false }),
        sample({ model: "gpt", tokens: 10, priced: true }),
      ],
      pricing,
    );

    expect(stats.unpriced).toEqual(["free"]);
    expect(stats.pricedTokens).toBe(110);
    expect(stats.activeDays).toBe(2);
    expect(stats.cacheSavings).toBeCloseTo(1.5);
  });

  it("returns empty figures for no samples", () => {
    expect(usageSampleStats([], pricing)).toEqual({
      unpriced: [],
      pricedTokens: 0,
      activeDays: 0,
      cacheSavings: 0,
    });
  });
});

describe("searchRows", () => {
  it("keeps rows whose text contains the search, ignoring case", () => {
    const rows = [{ label: "OpenAI" }, { label: "Anthropic" }, { label: "open-router" }];

    expect(searchRows(rows, (row) => row.label, "OPEN", "en-US")).toEqual([
      { label: "OpenAI" },
      { label: "open-router" },
    ]);
  });

  it("matches on the text the caller selects", () => {
    const rows = [{ title: "Fix login", project: "app" }];

    expect(searchRows(rows, (row) => `${row.title} ${row.project}`, "login app", "en-US")).toEqual(
      rows,
    );
    expect(searchRows(rows, (row) => row.title, "", "en-US")).toEqual(rows);
  });
});
