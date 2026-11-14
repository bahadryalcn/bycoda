import { describe, expect, it } from "vitest";
import {
  accountSwitcherKind,
  accountUsageSummary,
  ascendingEffortOptions,
  settingControlKind,
  settingGridColumns,
  splitPanelSettings,
} from "./modelPanelData";
import type { ModelSetting } from "./models";
import type { ProviderRateLimits } from "../../providers/public/accountUsage";

const select = (id: string, count: number): ModelSetting => ({
  id,
  label: id,
  kind: "select",
  value: "0",
  options: Array.from({ length: count }, (_, index) => ({
    value: String(index),
    label: String(index),
  })),
});

const limits = (windows: Partial<ProviderRateLimits>): ProviderRateLimits => ({
  provider: "claude",
  session: null,
  weekly: null,
  monthly: null,
  resetCredits: null,
  updatedAt: 0,
  error: null,
  status: "ok",
  ...windows,
});

describe("accountSwitcherKind", () => {
  it("changes only at one, two, three and six accounts", () => {
    expect([0, 1, 2, 3, 5, 6, 10].map(accountSwitcherKind)).toEqual([
      "none",
      "label",
      "switch",
      "menu",
      "menu",
      "search",
      "search",
    ]);
  });
});

describe("settingControlKind", () => {
  it("keeps every control inline, sized by its option count", () => {
    expect(settingControlKind({ ...select("fast", 2), kind: "toggle" })).toBe("toggle");
    expect(settingControlKind(select("effort", 6))).toBe("effort");
    expect(settingControlKind(select("crossAdvisor", 4))).toBe("choices");
    expect(settingControlKind(select("autoCompact", 3))).toBe("segmented");
    expect(settingControlKind(select("autoCompactWindow", 6))).toBe("slider");
    expect(settingControlKind(select("agentProfile", 12))).toBe("list");
  });

  it("drops a segmented switch whose labels would not fit", () => {
    const compact = select("autoCompact", 3);
    expect(settingControlKind(compact, ["Default", "On", "Off"])).toBe("segmented");
    expect(settingControlKind(compact, ["Claude varsayılanı", "Açık", "Kapalı"])).toBe("grid");
  });

  it("picks grid columns that fill whole rows", () => {
    expect(settingGridColumns(["200K", "300K", "1M"])).toBe(3);
    expect(settingGridColumns(["Claude default", "200K"])).toBe(2);
    expect(settingGridColumns(["Claude varsayılanı", "Açık", "Kapalı"])).toBe(3);
    expect(settingGridColumns(["Default", "200K", "300K", "500K"])).toBe(4);
    expect(settingGridColumns(["Claude varsayılanı", "200K", "300K", "500K"])).toBe(2);
    expect(settingGridColumns(["Claude default", "200K", "300K", "500K", "750K", "1M"])).toBe(3);
    expect(settingGridColumns(["Long label one", "Long label two", "a", "b", "c"])).toBe(2);
  });
});

describe("ascendingEffortOptions", () => {
  const values = (list: string[]) =>
    ascendingEffortOptions(list.map((value) => ({ value }))).map((option) => option.value);

  it("reverses a catalog that lists reasoning highest first", () => {
    expect(values(["xhigh", "high", "medium", "low"])).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("keeps ascending and unknown levels in catalog order", () => {
    expect(values(["low", "medium", "high", "max", "ultrathink"])).toEqual([
      "low",
      "medium",
      "high",
      "max",
      "ultrathink",
    ]);
    expect(values(["fast", "deep"])).toEqual(["fast", "deep"]);
  });
});

describe("splitPanelSettings", () => {
  it("puts delegation rows on the Agents tab and everything else on Settings", () => {
    // Menu order: delegation, Context, then Reasoning beside the trigger.
    const split = splitPanelSettings([
      select("autoCompact", 3),
      select("effort", 3),
      select("crossSubagents", 3),
      select("subagentPolicy", 2),
      select("crossAdvisor", 3),
    ]);
    // Reasoning leads in the panel; the menu order is reversed.
    expect(split.model.map((setting) => setting.id)).toEqual(["effort", "autoCompact"]);
    // Single choices lead; the policy sits above the growing subagent list, which comes last.
    expect(split.agents.map((setting) => setting.id)).toEqual([
      "crossAdvisor",
      "subagentPolicy",
      "crossSubagents",
    ]);
  });
});

describe("accountUsageSummary", () => {
  const now = 1_000_000;

  it("reports the tightest window and its reset", () => {
    expect(
      accountUsageSummary(
        limits({
          session: { usedPercent: 20, windowMinutes: 300, resetsAt: now + 60_000 },
          weekly: { usedPercent: 57.6, windowMinutes: 10_080, resetsAt: now + 120_000 },
        }),
        now,
      ),
    ).toEqual({ usedPercent: 58, resetsAt: now + 120_000 });
  });

  it("counts a window whose reset has passed as unused", () => {
    expect(
      accountUsageSummary(
        limits({ weekly: { usedPercent: 100, windowMinutes: 10_080, resetsAt: now - 1 } }),
        now,
      ),
    ).toEqual({ usedPercent: 0, resetsAt: null });
  });

  it("has no usage without fresh data", () => {
    expect(accountUsageSummary(undefined, now)).toEqual({ usedPercent: null, resetsAt: null });
    expect(accountUsageSummary(limits({ status: "error" }), now)).toEqual({
      usedPercent: null,
      resetsAt: null,
    });
  });
});
