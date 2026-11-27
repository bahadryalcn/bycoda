// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BarChart } from "./bar-chart/bar-chart";
import { LineChart } from "./line-chart/line-chart";

const data = [
  { key: "a", label: "A", value: 5, values: [2, 3] },
  { key: "b", label: "B", value: 9, values: [4, 5] },
];

it("tints the fill of a series that asks for an area, and leaves other series alone", () => {
  const html = renderToStaticMarkup(
    createElement(LineChart, {
      label: "Usage",
      data: [
        { key: "a", label: "A", values: { x: 1, y: 2 } },
        { key: "b", label: "B", values: { x: 2, y: 3 } },
      ],
      series: [
        { key: "x", label: "X", color: "red", area: true },
        { key: "y", label: "Y", color: "blue", area: false },
      ],
    }),
  );
  expect(html.match(/data-tint/g)).toHaveLength(1);
});

it("draws one coloured bar per series and category when stacked", () => {
  const html = renderToStaticMarkup(
    createElement(BarChart, {
      label: "Usage",
      period: "A - B",
      data,
      stacked: true,
      seriesLabels: ["One", "Two"],
      seriesColors: ["red", "blue"],
    }),
  );
  expect(html).toContain("--bar-color:red");
  expect(html).toContain("--bar-color:blue");
  expect(html).toContain("data-stacked");
  // Stacked bars sit in one lane (no side-by-side offset) and keep the series legend.
  expect(html).not.toContain("data-lane");
  expect(html).toContain("One");
});

it("can hide the built-in series legend", () => {
  const html = renderToStaticMarkup(
    createElement(BarChart, {
      label: "Usage",
      period: "A - B",
      data,
      seriesLabels: ["One", "Two"],
      legend: false,
    }),
  );
  expect(html).not.toContain(`<ul`);
});
