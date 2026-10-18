// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invoke, fetchUsage, exportCsv, chart } = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetchUsage: vi.fn(),
  exportCsv: vi.fn(),
  chart: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("../../providers/model/providerAccounts", async (original) => ({
  ...(await original<typeof import("../../providers/model/providerAccounts")>()),
  providerAccounts: (provider: string) =>
    provider === "codex" ? [{ id: "default", provider, label: "Default", color: "pink" }] : [],
  subscribeProviderAccounts: () => () => {},
}));
vi.mock("../../providers/model/providerUsage", async (original) => ({
  ...(await original<typeof import("../../providers/model/providerUsage")>()),
  fetchProviderUsage: fetchUsage,
  fetchModelPrices: async () => null,
}));
vi.mock("../../group-lock/hooks/useGroupLock", () => ({
  useLockSnapshot: () => ({ lockedProjects: [] }),
}));
vi.mock("../../group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
vi.mock("../model/railGroups", () => ({ railGroupLookup: () => () => null }));
vi.mock("./UsageVisualizations", () => ({
  UsageTrend: (props: unknown) => {
    chart(props);
    return null;
  },
  UsageShare: () => null,
  Contribution: () => null,
  TimeDistribution: () => null,
}));
vi.mock("./UsageQuotaHistory", () => ({ QuotaHistory: () => null }));
vi.mock("../model/usageAnalytics", async (original) => {
  const real = await original<typeof import("../model/usageAnalytics")>();
  return {
    ...real,
    usageCsv: (rows: Parameters<typeof real.usageCsv>[0]) => {
      exportCsv(rows);
      return real.usageCsv(rows);
    },
  };
});
// Native adapters are tested separately. Expose their callback contract here.
vi.mock("../../../shared/ui/Select", () => ({
  Select: ({ label, value, options, onValueChange }: any) =>
    createElement(
      "select",
      { "aria-label": label, value, onChange: (e: any) => onValueChange(e.target.value) },
      options.map((o: any) => createElement("option", { key: o.value, value: o.value }, o.label)),
    ),
}));
vi.mock("../../../shared/ui/DateTimeRangePicker", () => ({
  DateTimeRangePicker: ({ onChange }: any) =>
    createElement(
      "button",
      { onClick: () => onChange({ start: new Date(2026, 9, 18), end: new Date(2026, 9, 19) }) },
      "Set custom interval",
    ),
}));
import { UsageOverview } from "./UsageOverview";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 19, 10, 1));
  vi.clearAllMocks();
  invoke.mockResolvedValue({ turns: [], truncated: false });
  fetchUsage.mockImplementation(async () => ({
    rows: [
      {
        slot: new Date(2026, 9, 19, 10, 16).getTime() / 1000,
        model: "gpt-5",
        project: "/project",
        input: 10,
        output: 0,
        cacheRead: 0,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
      },
    ],
  }));
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test";
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = async (refresh: number) =>
  act(async () => root.render(createElement(UsageOverview, { refresh })));
const selectPreset = async (value: string) =>
  act(async () => {
    const el = host.querySelector<HTMLSelectElement>('[aria-label="Date range"]')!;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
const until = () =>
  invoke.mock.calls.filter(([command]) => command === "session_usage_report").at(-1)![1].untilMs;
it("advances workspace refresh across a bucket and midnight, keeping charts and exports in the refreshed interval", async () => {
  await render(0);
  await selectPreset("today");
  expect(until()).toBe(new Date(2026, 9, 19, 10, 15).getTime());
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  await render(1);
  expect(until()).toBe(new Date(2026, 9, 19, 10, 30).getTime());
  expect(JSON.stringify(chart.mock.lastCall)).toContain('"input":10');
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Projects")!.click(),
  );
  const exportButton = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Export CSV"),
  )!;
  expect(exportButton).toBeTruthy();
  await act(async () => exportButton.click());
  expect(JSON.stringify(exportCsv.mock.lastCall)).toContain('"input":10');
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Overview")!.click(),
  );
  vi.setSystemTime(new Date(2026, 9, 20, 0, 1));
  await render(2);
  expect(until()).toBe(new Date(2026, 9, 20, 0, 15).getTime());
  expect(JSON.stringify(chart.mock.lastCall)).not.toContain('"input":10');
});
it("preserves explicit custom intervals during workspace refresh", async () => {
  await render(0);
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Set custom interval",
  )!;
  await act(async () => button.click());
  const original = until();
  expect(original).toBe(new Date(2026, 9, 19).getTime());
  vi.setSystemTime(new Date(2026, 9, 21, 12));
  await render(1);
  expect(until()).toBe(original);
});
