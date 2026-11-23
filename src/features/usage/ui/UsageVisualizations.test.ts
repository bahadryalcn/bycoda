// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { TimeDistribution, UsageTrend } from "./UsageVisualizations";
import { zeroUsage, type UsageSample } from "../model/usageAnalytics";
import { usageProviderLabel } from "./UsageProviderIdentity";

const chartData = vi.hoisted(() => ({
  labels: [] as string[],
  onActiveChange: undefined as
    | ((index: number | null, datum: { key: string } | null) => void)
    | undefined,
}));
vi.mock("../../../shared/ui/Charts", () => ({
  ActivityHeatmap: () => null,
  BarChart: () => null,
  HeatScale: () => null,
  DonutChart: () => null,
  LineChart: ({
    data,
    onActiveChange,
  }: {
    data: { label: string }[];
    onActiveChange: typeof chartData.onActiveChange;
  }) => {
    chartData.labels = data.map((point) => point.label);
    chartData.onActiveChange = onActiveChange;
    return null;
  },
}));
vi.mock("../../../shared/ui/Button", () => ({
  Button: ({
    children,
    tooltip: _tooltip,
    tooltipDetails,
    tooltipWide: _tooltipWide,
    iconOnly: _iconOnly,
    motion: _motion,
    label,
    disabledReason,
    ...props
  }: any) => {
    void _tooltip;
    void _tooltipWide;
    void _iconOnly;
    void _motion;
    return createElement(
      "button",
      {
        ...props,
        "aria-label": props["aria-label"] ?? label,
        "data-disabled-reason": disabledReason,
        "data-details": tooltipDetails
          ?.map((node: any) => (typeof node === "string" ? node : renderToStaticMarkup(node)))
          .join(" "),
      },
      children,
    );
  },
}));
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});
async function renderDay(samples: UsageSample[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  const start = new Date(2026, 10, 4).getTime();
  await act(async () =>
    root.render(
      createElement(TimeDistribution, {
        samples,
        metric: "cost",
        window: { start, end: start + 86_400_000 },
        onSelect: vi.fn(),
      }),
    ),
  );
  return host;
}
it("keeps one time column and one date column for a single day", async () => {
  const host = await renderDay();
  const grid = host.querySelector<HTMLElement>('[role="grid"]')!;
  expect(grid.style.getPropertyValue("--usage-week-columns")).toBe("1");
  expect(grid.hasAttribute("data-single-day")).toBe(false);
  expect(grid.querySelectorAll('[role="rowheader"]')).toHaveLength(24);
  expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(24);
  const firstCell = grid.querySelector<HTMLButtonElement>('[role="gridcell"]')!;
  await act(async () => {
    firstCell.focus();
    firstCell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.activeElement).toBe(grid.querySelectorAll('[role="gridcell"]')[1]);
});
it("exposes actual provider model and project on hour hover", async () => {
  const host = await renderDay([
    {
      ...zeroUsage(),
      source: "logs",
      at: new Date(2026, 10, 4, 14).getTime(),
      provider: "codex",
      account: "codex:default",
      accountLabel: "Default account",
      model: "gpt-5",
      project: "/projects/demo",
      projectLabel: "Demo",
      group: "",
      groupLabel: "",
      priced: true,
      cost: 12,
    },
  ]);
  expect(host.querySelectorAll('[role="gridcell"]')[14].getAttribute("data-details")).toContain(
    "GPT-5",
  );
  expect(host.querySelectorAll('[role="gridcell"]')[14].getAttribute("data-details")).toContain(
    "Demo",
  );
});
it("mounts the trend table only while its disclosure is open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const start = new Date(2026, 10, 4).getTime();
  const values = { ...zeroUsage(), cost: 12 };
  const buckets = [0, 1].map((index) => ({
    ...values,
    key: String(index),
    start: start + index * 86400000,
    end: start + (index + 1) * 86400000,
    series: { codex: values },
  }));
  const series = [
    { ...values, key: "codex", label: "codex", unpricedTokens: 0, logSamples: 1, timedSamples: 0 },
  ];
  try {
    await act(async () =>
      root.render(
        createElement(UsageTrend, {
          buckets,
          series,
          metric: "cost",
          resolution: "day",
          percent: false,
          colors: new Map(),
          onSelect: vi.fn(),
        }),
      ),
    );
    const details = host.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(host.querySelector("tbody")).toBeNull();
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(host.querySelector("tbody")).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
it("uses canonical provider titles and preserves unknown identities", () => {
  expect(usageProviderLabel("codex")).toBe("Codex");
  expect(usageProviderLabel("claude")).toBe("Claude Code");
  expect(usageProviderLabel("custom-provider")).toBe("custom-provider");
});
it("keeps unpriced usage visible without reporting a zero cost", async () => {
  const base: UsageSample = {
    ...zeroUsage(),
    source: "logs",
    at: new Date(2026, 10, 4, 14).getTime(),
    provider: "codex",
    account: "codex:default",
    accountLabel: "Default account",
    model: "gpt-5",
    project: "/projects/demo",
    projectLabel: "Demo",
    group: "",
    groupLabel: "",
    priced: false,
    tokens: 100,
  };
  const host = await renderDay([base, { ...base, priced: true, cost: 12 }]);
  const details = host.querySelectorAll('[role="gridcell"]')[14].getAttribute("data-details");
  expect(details).toContain("Unavailable");
  expect(details).toContain("$12.00");
  expect(details).not.toContain("$0.00");
});

it("updates cached trend date labels when language changes with identical data", async () => {
  const { setLanguagePreference } = await import("../../../shared/i18n");
  const { formatBucket } = await import("./UsageCharts");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const start = new Date(2026, 10, 4).getTime();
  const values = { ...zeroUsage(), cost: 12 };
  const buckets = [0, 1].map((index) => ({
    ...values,
    key: String(index),
    start: start + index * 86400000,
    end: start + (index + 1) * 86400000,
    series: { codex: values },
  }));
  const series = [
    { ...values, key: "codex", label: "codex", unpricedTokens: 0, logSamples: 1, timedSamples: 0 },
  ];
  try {
    await act(async () =>
      root.render(
        createElement(UsageTrend, {
          buckets,
          series,
          metric: "cost",
          resolution: "day",
          percent: false,
          colors: new Map(),
          onSelect: vi.fn(),
        }),
      ),
    );
    const english = chartData.labels[0];
    await act(async () => {
      await setLanguagePreference("tr");
    });
    expect(chartData.labels[0]).toBe(formatBucket(start, "day"));
    expect(chartData.labels[0]).not.toBe(english);
  } finally {
    act(() => root.unmount());
    host.remove();
    await setLanguagePreference("en");
  }
});

function dayBucket(index: number) {
  const values = { ...zeroUsage(), cost: 12 };
  const start = new Date(2026, 10, 4).getTime() + index * 86400000;
  return { ...values, key: String(index), start, end: start + 86400000, series: { codex: values } };
}
async function renderTrend(onSelect: (window: { start: number; end: number }) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  const series = [
    {
      ...zeroUsage(),
      cost: 12,
      key: "codex",
      label: "codex",
      unpricedTokens: 0,
      logSamples: 1,
      timedSamples: 0,
    },
  ];
  await act(async () =>
    root.render(
      createElement(UsageTrend, {
        buckets: [dayBucket(0), dayBucket(1)],
        series,
        metric: "cost",
        resolution: "day",
        percent: false,
        colors: new Map(),
        onSelect,
      }),
    ),
  );
  return host;
}
/** The chart's wrapper: clicking it (or Enter inside it) selects the active point's interval. */
function chartArea(host: HTMLElement) {
  return host.querySelector<HTMLElement>('[data-usage-chart="trend"] > div:not([class])')!;
}
it("has no select-interval button and clears the target when the chart reports no active point", async () => {
  const onSelect = vi.fn();
  const host = await renderTrend(onSelect);
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
    "Select interval",
  );
  await act(async () => chartData.onActiveChange?.(1, { key: "1" }));
  await act(async () => chartData.onActiveChange?.(null, null));
  await act(async () => chartArea(host).click());
  expect(onSelect).not.toHaveBeenCalled();
});
it("applies the bucket the chart reports when the chart is clicked", async () => {
  const onSelect = vi.fn();
  const host = await renderTrend(onSelect);
  await act(async () => chartData.onActiveChange?.(1, { key: "1" }));
  await act(async () => chartArea(host).click());
  expect(onSelect).toHaveBeenCalledWith({ start: dayBucket(1).start, end: dayBucket(1).end });
});
