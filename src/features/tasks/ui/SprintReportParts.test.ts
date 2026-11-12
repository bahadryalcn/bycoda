// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SprintKpi } from "./SprintReportParts";

it.each([
  [undefined, "progressbar"],
  ["capacity", "meter"],
] as const)("uses the correct measure for %s", (kind, role) => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(SprintKpi, {
      label: "Points",
      value: "3 / 8",
      meter: { kind, value: 3, max: 8, valueText: "3 / 8 points" },
    }),
  );
  const measure = container.querySelector(`[role="${role}"]`)!;
  expect(measure.getAttribute("aria-label")).toBe("Points");
  expect(measure.getAttribute("aria-valuetext")).toBe("3 / 8 points");
});
