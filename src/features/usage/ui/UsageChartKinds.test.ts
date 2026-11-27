// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageShare, UsageTrend } from "./UsageVisualizations";
import { zeroUsage } from "../model/usageAnalytics";

const seen = vi.hoisted(() => ({
  line: undefined as undefined | { series: { area?: boolean }[]; data: any[]; label: string },
  bar: undefined as undefined | Record<string, any>,
  donut: 0,
}));
vi.mock("../../../shared/ui/Charts", () => ({
  ActivityHeatmap: () => null,
  HeatScale: () => null,
  BarChart: (props: Record<string, any>) => {
    seen.bar = props;
    return null;
  },
  DonutChart: () => {
    seen.donut += 1;
    return null;
  },
  LineChart: (props: any) => {
    seen.line = props;
    return null;
  },
}));

let host: HTMLDivElement;
let unmount: () => void;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  seen.line = undefined;
  seen.bar = undefined;
  seen.donut = 0;
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  (host as any).root = root;
});
afterEach(() => {
  unmount();
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const render = (node: unknown) => act(async () => (host as any).root.render(node));
const choose = (name: string) =>
  act(async () => {
    const option = [...host.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (node) => node.textContent?.trim() === name,
    );
    option!.click();
  });

const start = new Date(2026, 10, 4).getTime();
const usage = (cost: number) => ({ ...zeroUsage(), cost });
const buckets = [1, 2, 3].map((index) => ({
  ...usage(index * 10),
  key: String(index),
  start: start + index * 86_400_000,
  end: start + (index + 1) * 86_400_000,
  series: { codex: usage(index * 4), claude: usage(index * 6) },
}));
const series = ["codex", "claude"].map((key) => ({
  ...usage(10),
  key,
  label: key,
  unpricedTokens: 0,
  logSamples: 1,
  timedSamples: 0,
}));
const trend = () =>
  createElement(UsageTrend, {
    buckets,
    series,
    metric: "cost",
    resolution: "day",
    percent: false,
    colors: new Map(),
    onSelect: vi.fn(),
  });

it("switches the trend between line, area, stacked bar and cumulative, and remembers it", async () => {
  await render(trend());
  expect(seen.line!.series.every((s) => s.area === false)).toBe(true);
  expect(seen.bar).toBeUndefined();

  await choose("Area");
  expect(seen.line!.series.every((s) => s.area === true)).toBe(true);

  await choose("Cumulative");
  expect(seen.line!.data.map((point) => point.values.codex)).toEqual([4, 12, 24]);
  expect(seen.line!.label).toContain("Cumulative");

  await choose("Stacked bar");
  expect(seen.bar!.stacked).toBe(true);
  expect(seen.bar!.seriesLabels).toHaveLength(2);
  expect(seen.bar!.data[0].values).toEqual([4, 6]);
  expect(seen.bar!.data[0].value).toBe(10);

  // A new mount starts on the remembered type.
  unmount();
  seen.bar = undefined;
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  (host as any).root = root;
  unmount = () => act(() => root.unmount());
  await render(trend());
  expect(seen.bar!.stacked).toBe(true);
});

it("shows the share panel as a donut or as ranked bars", async () => {
  const rows = [
    {
      ...usage(30),
      key: "codex",
      label: "codex",
      unpricedTokens: 0,
      logSamples: 1,
      timedSamples: 0,
    },
    {
      ...usage(10),
      key: "claude",
      label: "claude",
      unpricedTokens: 0,
      logSamples: 1,
      timedSamples: 0,
    },
  ];
  await render(
    createElement(UsageShare, { rows, metric: "cost", colors: new Map(), onSelect: vi.fn() }),
  );
  expect(seen.donut).toBeGreaterThan(0);
  expect(host.querySelector(".usage-rank-track")).toBeNull();
  const donuts = seen.donut;

  await choose("Bar");
  expect(seen.donut).toBe(donuts);
  expect(host.querySelectorAll(".usage-rank-track")).toHaveLength(2);
});
