import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ActivityOverview } from "../hooks/useActivityOverview";
vi.mock("../../../shared/ui/SegmentedControl", () => ({
  SegmentedControl: ({ options }: { options: { value: string; label: string }[] }) =>
    createElement(
      "div",
      null,
      options.map((option) =>
        createElement("span", { key: option.value, "data-value": option.value }, option.label),
      ),
    ),
}));
import { ActivitySources } from "./ActivitySources";
it("names the direct machine scope without excluding its connected Hosts", () => {
  const overview: ActivityOverview = {
    source: "machines",
    scope: "machines",
    setScope: vi.fn(),
    canChooseScope: true,
    summary: null,
    failed: false,
    devices: [],
    machines: [
      {
        id: "local",
        name: "Local",
        local: true,
        status: "ok",
        totals: { today: 1, week: 1, month: 1, year: 1 },
      },
      { id: "remote", name: "Office", local: false, status: "unavailable" },
    ],
  };
  const html = renderToStaticMarkup(createElement(ActivitySources, { overview }));
  expect(html).toContain('data-value="machines">Machines');
  expect(html).toContain("This machine + 1 connected machine");
  expect(html).toContain("Unavailable");
});
