// @vitest-environment happy-dom
import { clearUsageLoadCache } from "../model/usageLoadCache";
import type { UsageFilters } from "../model/usageAnalytics";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RevealedSetting } from "../../../shared/ui/settings";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invoke, fetchUsage, fetchPrices, exportCsv, chart } = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetchUsage: vi.fn(),
  fetchPrices: vi.fn(),
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
  fetchModelPrices: fetchPrices,
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
vi.mock("../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: ({ label, onChange, options }: any) =>
    createElement(
      "div",
      {},
      createElement("button", { onClick: () => onChange(["missing"]) }, `Exclude ${label}`),
      options.map((option: any) =>
        createElement(
          "button",
          {
            key: option.value,
            onClick: () => onChange([option.value]),
          },
          `Select ${label} ${option.label}`,
        ),
      ),
    ),
}));
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";
import { UsageOverview } from "./UsageOverview";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 19, 10, 1));
  vi.clearAllMocks();
  clearUsageLoadCache();
  fetchPrices.mockResolvedValue(null);
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
it("renders local usage with built-in estimates while prices load and ignores a superseded price read", async () => {
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  invoke.mockResolvedValue({
    turns: [
      {
        sessionId: "session",
        title: "Session",
        project: "/project",
        provider: "codex",
        accountId: "default",
        model: "gpt-5",
        startedAt: Date.now() - 3_600_000,
        durationMs: 3_600_000,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ],
    truncated: false,
  });
  let finishOld!: (value: null) => void;
  fetchPrices.mockReturnValueOnce(
    new Promise((resolve) => {
      finishOld = resolve;
    }),
  );
  await render(0);
  expect(host.querySelector(".usage-metrics")).toBeTruthy();
  expect(host.textContent).toContain("Using built-in prices while model prices load.");
  expect(JSON.stringify(chart.mock.lastCall)).toContain('"input":10');
  expect(JSON.stringify(chart.mock.lastCall)).toContain('"duration":3600000');
  fetchPrices.mockResolvedValue({
    models: [{ id: "openai/gpt-5", input: 1, output: 1 }],
    fetchedAt: 1,
  });
  await render(1);
  const cost = () => host.querySelector(".usage-metrics strong")?.textContent;
  expect(cost()).toContain("10");
  await act(async () => finishOld(null));
  expect(cost()).toContain("10");
  expect(host.textContent).not.toContain("Using built-in prices while model prices load.");
});

it("reuses the last completed prices on reopen until the new read settles", async () => {
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  fetchPrices.mockResolvedValue({
    models: [{ id: "openai/gpt-5", input: 1, output: 1 }],
    fetchedAt: 1,
  });
  const cost = () => host.querySelector(".usage-metrics strong")?.textContent;
  await render(0);
  expect(cost()).toContain("10");
  await act(async () => root.unmount());
  let rejectPrices!: (cause: Error) => void;
  fetchPrices.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectPrices = reject;
    }),
  );
  root = createRoot(host);
  await render(0);
  expect(cost()).toContain("10");
  await act(async () => rejectPrices(new Error("price source unavailable")));
  expect(cost()).toContain("0.00");
  await render(1);
  expect(cost()).toContain("10");
});

it("defers Limits until visited and retains the user's draft across tabs", async () => {
  const limits = vi.fn(() => createElement("input", { "aria-label": "Budget draft" }));
  await act(async () => root.render(createElement(UsageOverview, { limits })));
  expect(limits).not.toHaveBeenCalled();
  const visit = (label: string) =>
    act(async () => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === label)!.click();
    });
  await visit("Limits");
  const draft = host.querySelector<HTMLInputElement>('[aria-label="Budget draft"]')!;
  draft.value = "27";
  await visit("Overview");
  await visit("Limits");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Budget draft"]')?.value).toBe("27");
});

it("opens Limits directly for a budget setting revealed on first mount", async () => {
  const limits = () => createElement("input", { "aria-label": "Budget draft" });
  await act(async () =>
    root.render(
      createElement(
        RevealedSetting.Provider,
        { value: "usage-budgets" },
        createElement(UsageOverview, { limits }),
      ),
    ),
  );
  expect(host.querySelector<HTMLElement>(".usage-limits-view")?.hidden).toBe(false);
  expect(host.querySelector('[aria-label="Budget draft"]')).toBeTruthy();
});

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
  const exportButton = host.querySelector<HTMLButtonElement>('button[aria-label="Export CSV"]')!;
  expect(exportButton).toBeTruthy();
  expect(exportButton.textContent).toContain("Export CSV");
  const tableDetails = [...host.querySelectorAll("details")].find((el) =>
    el.querySelector("summary")?.textContent?.includes("Show as table"),
  );
  expect(tableDetails).toBeTruthy();
  expect(tableDetails!.open).toBe(false);
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
  await selectPreset("custom");
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Set custom interval",
  )!;
  await act(async () => button.click());
  const original = until();
  expect(original).toBe(new Date(2026, 9, 19).getTime());
  vi.setSystemTime(new Date(2026, 9, 21, 12));
  await render(1);
  expect(until()).toBe(original);
});

it("keeps one date owner and chart options outside the Filters popover", async () => {
  // The fixture row is at 10:16; an empty period shows one empty state instead of the options.
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  await render(0);
  // The metric tiles choose the metric on Overview, so there is no second chooser.
  expect(host.querySelector('[aria-label="Chart metric"]')).toBeNull();
  expect(host.querySelector('[aria-label="Group by"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="Resolution"]')).toBeTruthy();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  expect(
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Set custom interval"),
  ).toBeUndefined();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  await selectPreset("custom");
  expect(
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Set custom interval"),
  ).toBeTruthy();
});

it("keeps the header Refresh available in partial states", async () => {
  invoke.mockRejectedValue(new Error("unavailable"));
  await render(0);
  expect(host.textContent).toContain("Duration and session totals may be incomplete");
  expect(host.querySelector('[aria-label="Refresh usage"]')).toBeTruthy();
});

it("keeps loading distinct from trustworthy zero usage", async () => {
  fetchUsage.mockReturnValue(new Promise(() => {}));
  await render(0);
  // The passive loader stays hidden for LOADING_DELAY_MS so a quick load never flashes it.
  expect(host.querySelector('[role="status"][aria-label="Loading usage…"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS));
  expect(host.querySelector('[role="status"][aria-label="Loading usage…"]')).not.toBeNull();
  expect(host.querySelector(".usage-metrics")).toBeNull();
  expect(chart).not.toHaveBeenCalled();
});

it("shows the previous read at once when the page opens again while it refreshes", async () => {
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  await render(0);
  expect(host.querySelector(".usage-metrics")).toBeTruthy();
  await act(async () => root.unmount());
  fetchUsage.mockReturnValue(new Promise(() => {}));
  root = createRoot(host);
  await render(0);
  expect(host.querySelector('[role="status"][aria-label="Loading usage…"]')).toBeNull();
  expect(host.querySelector(".usage-metrics")).toBeTruthy();
});

it("shows an actionable failure without zero metrics or empty charts", async () => {
  fetchUsage.mockRejectedValue(new Error("unavailable"));
  invoke.mockRejectedValue(new Error("unavailable"));
  await render(0);
  expect(host.textContent).toContain("Usage could not be read");
  expect(host.textContent).not.toContain("No usage matches");
  expect(host.querySelector(".usage-metrics")).toBeNull();
  expect(chart).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Refresh usage"]')).toBeTruthy();
});

it("labels retained results after a failed refresh", async () => {
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  await render(0);
  fetchUsage.mockRejectedValue(new Error("unavailable"));
  invoke.mockRejectedValue(new Error("unavailable"));
  await render(1);
  expect(host.textContent).toContain("Previous usage remains visible");
  expect(host.querySelector(".usage-metrics")).toBeTruthy();
  expect(JSON.stringify(chart.mock.lastCall)).toContain('"input":10');
});

it("marks missing session data as partial without suppressing readable provider usage", async () => {
  vi.setSystemTime(new Date(2026, 9, 19, 10, 20));
  invoke.mockRejectedValue(new Error("unavailable"));
  await render(0);
  expect(host.textContent).toContain("Duration and session totals may be incomplete");
  expect(host.querySelector(".usage-metrics")).toBeTruthy();
  expect(JSON.stringify(chart.mock.lastCall)).toContain('"input":10');
  chart.mockClear();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Agent time")!
      .click(),
  );
  expect(chart).not.toHaveBeenCalled();
  expect(host.querySelector(".usage-metrics")).toBeTruthy();
});

it("shows true zero usage separately from a filter-empty result", async () => {
  fetchUsage.mockResolvedValue({ rows: [] });
  await render(0);
  expect(host.textContent).toContain("No usage recorded in this period.");
  expect(host.textContent).not.toContain("No usage matches these filters.");
  // One empty state replaces the tiles, charts and panels.
  expect(host.querySelector(".usage-metrics")).toBeNull();
});

it("names an empty filtered result and offers a filter reset", async () => {
  await render(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "Exclude Model")!
      .click(),
  );
  expect(host.textContent).toContain("No usage matches these filters.");
  expect(document.body.textContent).toContain("Reset filters");
  expect(host.querySelector('[aria-label="Filters (1)"]')).toBeTruthy();
});

it("preserves independent Grok provider and account filters for limits", async () => {
  const limits = vi.fn<(filters: UsageFilters) => null>(() => null);
  await act(async () => root.render(createElement(UsageOverview, { limitsOnly: true, limits })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  const choose = (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (el) => el.textContent === label,
      );
      expect(button).toBeTruthy();
      button!.click();
    });
  await choose("Select Provider Grok");
  expect(limits.mock.lastCall?.[0]).toMatchObject({ provider: ["grok"], account: [] });
  await choose("Select Account Grok");
  expect(limits.mock.lastCall?.[0]).toMatchObject({
    provider: ["grok"],
    account: ["grok:default"],
  });
  await choose("Select Provider Codex");
  expect(limits.mock.lastCall?.[0]).toMatchObject({
    provider: ["codex"],
    account: ["grok:default"],
  });
});
