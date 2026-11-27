// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Contribution } from "./UsageVisualizations";
import { formatUsagePercent } from "./UsageCharts";
import { zeroUsage, type UsageBreakdown } from "../model/usageAnalytics";

vi.mock("../../../shared/ui/Button", () => ({
  Button: ({
    children,
    variant: _variant,
    truncate: _truncate,
    ...props
  }: {
    children?: unknown;
    variant?: string;
    truncate?: boolean;
    [key: string]: unknown;
  }) => createElement("button", props, children as never),
}));

type Row = UsageBreakdown & { providers?: string[] };

/** Ten-token rows first, then two 25-token rows: the whole list totals 100, the first five total 65. */
const values = [10, 10, 10, 10, 10, 25, 25];
const rows: Row[] = values.map(
  (tokens, index) =>
    ({
      ...zeroUsage(),
      key: `project-${index + 1}`,
      label: `Project ${index + 1}`,
      tokens,
      unpricedTokens: 0,
      logSamples: 0,
    }) as Row,
);

function render(list: Row[]) {
  return renderToStaticMarkup(
    createElement(Contribution, {
      rows: list,
      metric: "tokens",
      title: "Leading projects",
      onSelect: () => {},
      colors: new Map(),
    }),
  );
}

it("renders only the first five rows and defers the rest behind a disclosure", () => {
  const html = render(rows);

  expect(html).toContain("Project 5");
  expect(html).not.toContain("Project 6");
  expect(html).not.toContain("Project 7");
  expect(html).toContain("<details");
  expect(html).toContain("Show all");
});

it("measures shares against the whole list, not only the visible rows", () => {
  const html = render(rows);

  // 10 of 100 tokens is 10%; against the visible-only total of 65 it would be ~15.4%.
  expect(html).toContain(formatUsagePercent(10));
  expect(html).not.toContain(formatUsagePercent((10 / 65) * 100));
});

it("adds no disclosure when the list fits in the visible rows", () => {
  const html = render(rows.slice(0, 5));

  expect(html).toContain("Project 5");
  expect(html).not.toContain("<details");
});
