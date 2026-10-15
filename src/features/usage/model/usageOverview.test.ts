import { describe, expect, it } from "vitest";
import type { AccountUsage, UsageRow } from "../../providers/model/providerUsage";
import type { ProviderAccount } from "../../providers/model/providerAccounts";
import { summarizeUsageOverview, usageRangeSince, type UsageGroupLookup } from "./usageOverview";

const NOW = new Date(2026, 8, 30, 12, 0, 0);
const at = (day: number, hour = 10) => new Date(2026, 8, day, hour, 0, 0).getTime() / 1000;

const account = (provider: "claude" | "codex"): ProviderAccount =>
  ({ id: "default", provider, label: "Default" }) as ProviderAccount;

function row(patch: Partial<UsageRow> & Pick<UsageRow, "slot">): UsageRow {
  return {
    model: "claude-sonnet-4-5",
    project: "/work/app",
    input: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    output: 0,
    ...patch,
  };
}

const noGroups: UsageGroupLookup = () => null;

const usage: AccountUsage[] = [
  {
    account: account("claude"),
    rows: [
      // $3 per million input, $15 per million output.
      row({ slot: at(29), input: 1_000_000, output: 100_000 }),
      row({ slot: at(30), project: "/work/site", input: 2_000_000 }),
      row({ slot: at(29, 11), project: "C:\\Work\\Mixed", output: 10 }),
      row({ slot: at(29, 12), project: "C:/work/mixed", output: 10 }),
    ],
  },
  {
    account: account("codex"),
    rows: [
      // gpt-5.5: $5 input, $30 output per million.
      row({
        slot: at(30, 9),
        model: "gpt-5.5",
        project: "/work/app",
        input: 1_000_000,
      }),
    ],
  },
];

describe("summarizeUsageOverview", () => {
  it("bounds custom local-day ranges inclusively and excludes later rows from every total", () => {
    const start = new Date(2026, 8, 29);
    const end = new Date(2026, 8, 29);
    const data = summarizeUsageOverview(usage, "30d", NOW, "provider", noGroups, undefined, {
      start,
      end,
    });
    expect(data.days.map((day) => day.key)).toEqual(["2026-09-29"]);
    expect(data.totals.input).toBe(1_000_000);
    expect(data.projects.some((project) => project.label === "site")).toBe(false);
    expect(data.series.map((series) => series.key)).toEqual(["claude"]);
    expect(start.getDate()).toBe(29);
    expect(end.getDate()).toBe(29);
  });

  it("includes the final day's last second and rejects the next local midnight", () => {
    const selected = [
      {
        account: account("claude"),
        rows: [
          row({ slot: new Date(2026, 8, 30, 23, 59, 59).getTime() / 1000, input: 7 }),
          row({ slot: new Date(2026, 9, 1).getTime() / 1000, input: 11 }),
        ],
      },
    ];
    const data = summarizeUsageOverview(selected, "all", NOW, "provider", noGroups, undefined, {
      start: new Date(2026, 8, 29),
      end: new Date(2026, 8, 30),
    });
    expect(data.days).toHaveLength(2);
    expect(data.totals.input).toBe(7);
  });
  it("prices rows per day and project in API-equivalent dollars", () => {
    const data = summarizeUsageOverview(usage, "7d", NOW, "provider", noGroups);
    expect(data.days).toHaveLength(7);
    const day29 = data.days.find((day) => day.key === "2026-09-29")!;
    const day30 = data.days.find((day) => day.key === "2026-09-30")!;
    expect(day29.cost).toBeCloseTo(3 + 1.5, 3);
    expect(day30.cost).toBeCloseTo(6 + 5, 3);
    expect(Object.keys(day30.series).sort()).toEqual(["claude", "codex"]);
    expect(day30.series.codex.cost).toBeCloseTo(5, 3);

    const [first, second] = data.projects;
    expect(first.label).toBe("app");
    expect(first.cost).toBeCloseTo(3 + 1.5 + 5, 3);
    expect(first.input).toBe(2_000_000);
    expect(first.output).toBe(100_000);
    expect(second.label).toBe("site");
    expect(data.totals.cost).toBeCloseTo(15.5, 3);
  });

  it("merges one folder spelled two ways and reports unknown folders", () => {
    const data = summarizeUsageOverview(
      [
        ...usage,
        {
          account: account("claude"),
          rows: [row({ slot: at(29), project: "", output: 1 })],
        },
      ],
      "7d",
      NOW,
      "provider",
      noGroups,
    );
    const mixed = data.projects.filter((project) => project.label === "Mixed");
    expect(mixed).toHaveLength(1);
    expect(mixed[0].output).toBe(20);
    expect(data.projects.some((p) => p.label === "Unknown folder")).toBe(true);
  });

  it("limits the range and extends all-time back to the first log", () => {
    const old = row({
      slot: new Date(2026, 5, 1, 10).getTime() / 1000,
      output: 5,
    });
    const withOld = [{ account: account("claude"), rows: [...usage[0].rows, old] }];
    expect(summarizeUsageOverview(withOld, "30d", NOW, "provider", noGroups).totals.output).toBe(
      100_020,
    );
    const all = summarizeUsageOverview(withOld, "all", NOW, "provider", noGroups);
    expect(all.totals.output).toBe(100_025);
    expect(all.days[0].key).toBe("2026-06-01");
    expect(all.days[all.days.length - 1].key).toBe("2026-09-30");
    expect(usageRangeSince("all", NOW)).toBe(0);
    expect(usageRangeSince("7d", NOW)).toBe(new Date(2026, 8, 24).getTime());
  });

  it("stacks by model, collapsing the tail into Other models", () => {
    const models = Array.from({ length: 7 }, (_, index) =>
      row({
        slot: at(30),
        model: `claude-sonnet-4-5-v${index}`,
        output: (index + 1) * 1_000,
      }),
    );
    const data = summarizeUsageOverview(
      [{ account: account("claude"), rows: models }],
      "7d",
      NOW,
      "model",
      noGroups,
    );
    expect(data.series).toHaveLength(6);
    expect(data.series[5]).toEqual({ key: "other", label: "Other models" });
    expect(data.series[0].key).toBe("claude-sonnet-4-5-v6");
    const day = data.days.find((entry) => entry.key === "2026-09-30")!;
    expect(day.series.other.tokens).toBe(3_000);
    expect(Object.values(day.series).reduce((sum, slice) => sum + slice.tokens, 0)).toBe(
      day.tokens,
    );
  });

  it("groups projects by rail group, costliest group first, ungrouped last", () => {
    const groupFor: UsageGroupLookup = (project) =>
      project === "/work/site"
        ? { id: "g1", name: "Client" }
        : project === "/work/app"
          ? { id: "g2", name: "Internal" }
          : null;
    const data = summarizeUsageOverview(usage, "7d", NOW, "provider", groupFor);
    expect(data.groups.map((group) => group.name)).toEqual(["Internal", "Client", null]);
    expect(data.groups[0].cost).toBeCloseTo(9.5, 3);
    expect(data.groups[2].projects[0].label).toBe("Mixed");
  });

  it("counts tokens for unpriced models without inventing a cost", () => {
    const data = summarizeUsageOverview(
      [
        {
          account: account("claude"),
          rows: [row({ slot: at(30), model: "mystery-1", output: 400 })],
        },
      ],
      "7d",
      NOW,
      "provider",
      noGroups,
    );
    expect(data.totals).toMatchObject({ tokens: 400, cost: 0 });
    expect(data.unpricedModels).toEqual(["mystery-1"]);
    expect(data.projects[0].partlyUnpriced).toBe(true);
  });

  it("returns a single empty day when nothing was logged", () => {
    const data = summarizeUsageOverview([], "all", NOW, "provider", noGroups);
    expect(data.days).toHaveLength(1);
    expect(data.totals.tokens).toBe(0);
    expect(data.projects).toEqual([]);
  });
});
