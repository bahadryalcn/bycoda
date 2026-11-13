// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { TimeDistribution } from "./UsageVisualizations";
import { zeroUsage, type UsageSample } from "../model/usageAnalytics";
import { usageProviderLabel } from "./UsageProviderIdentity";

vi.mock("../../../shared/ui/Charts", () => ({
  ActivityHeatmap: () => null,
  BarChart: () => null,
  DonutChart: () => null,
  LineChart: () => null,
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
