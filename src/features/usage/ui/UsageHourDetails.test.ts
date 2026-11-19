// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { HourDetails, TimeDistribution } from "./UsageVisualizations";
import { zeroUsage, type UsageSample } from "../model/usageAnalytics";

const modelLabelRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../sessions/public/ModelLabel", () => ({
  ModelLabel: ({ model }: { model: string }) => {
    modelLabelRenders.count += 1;
    return createElement("i", null, model);
  },
}));
vi.mock("../../../shared/ui/Charts", () => ({
  ActivityHeatmap: () => null,
  BarChart: () => null,
  HeatScale: () => null,
  DonutChart: () => null,
  LineChart: () => null,
}));
// Mirrors the shared Tooltip: detail lines are only rendered while one cell is "open".
vi.mock("../../../shared/ui/Button", () => ({
  Button: ({ children, tooltipDetails, "data-open": open, label, ...props }: any) =>
    createElement(
      "button",
      { ...props, "aria-label": props["aria-label"] ?? label },
      children,
      open ? tooltipDetails : null,
    ),
}));

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

const sample = (model: string, hour: number, cost: number): UsageSample => ({
  ...zeroUsage(),
  source: "logs",
  at: new Date(2026, 10, 4, hour).getTime(),
  provider: "codex",
  account: "codex:default",
  accountLabel: "Default account",
  model,
  project: `/projects/${model}`,
  projectLabel: model,
  group: "",
  groupLabel: "",
  priced: true,
  cost,
});

it("does not build hour tooltip details for cells whose tooltip is closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  const start = new Date(2026, 10, 4).getTime();
  modelLabelRenders.count = 0;
  await act(async () =>
    root.render(
      createElement(TimeDistribution, {
        samples: [sample("gpt-5", 14, 12), sample("gpt-4", 9, 3)],
        metric: "cost",
        window: { start, end: start + 86_400_000 },
        onSelect: vi.fn(),
      }),
    ),
  );
  expect(host.querySelectorAll('[role="gridcell"]')).toHaveLength(24);
  expect(modelLabelRenders.count).toBe(0);
});

it("renders every hour detail row up to six with the remainder and a sorted order", () => {
  const entries = new Map(
    [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => {
      const entry = sample(`model-${rank}`, 14, rank);
      return [`m${rank}`, { sample: entry, value: rank }] as const;
    }),
  );
  const markup = renderToStaticMarkup(
    createElement(HourDetails, { entries, metric: "cost" }),
  );
  expect(markup.indexOf("model-8")).toBeLessThan(markup.indexOf("model-3"));
  expect(markup).not.toContain("model-2<");
  expect(markup).toContain("+2");
});

it("keeps the empty-hour message as the lazy detail body", () => {
  expect(renderToStaticMarkup(createElement(HourDetails, { entries: undefined, metric: "cost" }))).toBe(
    "No usage recorded in this period.",
  );
});
