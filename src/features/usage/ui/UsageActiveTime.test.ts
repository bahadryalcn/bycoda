import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../../activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../activity")>()),
  useActivityOverview: () => ({
    source: "machines",
    scope: "machines",
    setScope: () => {},
    canChooseScope: false,
    summary: { today: 42, week: 90, month: 120, year: 500, last7Days: [] },
    failed: false,
    machines: [],
    devices: [],
  }),
}));
import { UsageActiveTime } from "./UsageActiveTime";

it("shows active time figures with the source note", () => {
  const markup = renderToStaticMarkup(createElement(UsageActiveTime));
  expect(markup).toContain("Active time");
  expect(markup).toContain("This machine only");
  expect(markup).toContain("This year");
});
