import { expect, it } from "vitest";
import {
  providerAccountColorValue,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";
import { usageChartColor, usageColorMap } from "./usageColors";
import { zeroUsage, type UsageSample } from "./usageAnalytics";
it("uses the configured default profile for provider totals and follows color changes", () => {
  const accounts: ProviderAccount[] = [
    { provider: "codex", id: "work", label: "Work", color: "orange" },
    { provider: "codex", id: "default", label: "Default", color: "blue" },
    { provider: "claude", id: "default", label: "Claude", color: "pink" },
  ];
  const colors = usageColorMap(accounts, [], "provider");
  expect(usageChartColor(colors, "codex")).toBe(providerAccountColorValue(accounts[1]));
  expect(usageChartColor(colors, "codex:work")).toBe(providerAccountColorValue(accounts[0]));
  const changed = accounts.map((a) =>
    a.provider === "codex" && a.id === "default" ? { ...a, color: "purple" as const } : a,
  );
  expect(usageChartColor(usageColorMap(changed, [], "provider"), "codex")).toBe(
    providerAccountColorValue(changed[1]),
  );
});
it("attributes project/model color to its leading configured account", () => {
  const accounts: ProviderAccount[] = [
    { provider: "codex", id: "default", label: "Codex", color: "blue" },
    { provider: "claude", id: "default", label: "Claude", color: "pink" },
  ];
  const base: UsageSample = {
    ...zeroUsage(),
    source: "logs",
    at: 0,
    provider: "codex",
    account: "codex:default",
    accountLabel: "Codex",
    model: "model",
    project: "app",
    projectLabel: "App",
    group: "",
    groupLabel: "",
    priced: true,
    tokens: 100,
  };
  const samples = [base, { ...base, provider: "claude", account: "claude:default", tokens: 200 }];
  expect(usageChartColor(usageColorMap(accounts, samples, "project"), "app")).toBe(
    providerAccountColorValue(accounts[1]),
  );
});
