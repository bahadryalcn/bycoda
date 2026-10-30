// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferReportRecoveryView,
  type BufferReportDisplay,
  type BufferReportRecoveryModel,
} from "./BufferReportRecoveryView";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const report = (version: number, held: boolean): BufferReportDisplay => ({
  windowLabel: `Window ${version}`,
  reportVersion: version,
  updatedAt: 1,
  held,
  current: false,
  inspectable: true,
});
function model(
  records: BufferReportDisplay[],
  paging: { hasNext?: boolean; hasPrevious?: boolean } = {},
): BufferReportRecoveryModel<BufferReportDisplay> {
  return {
    visible: true,
    available: true,
    records,
    details: null,
    loading: false,
    loaded: true,
    error: false,
    readError: null,
    pending: null,
    hasNext: paging.hasNext ?? false,
    hasPrevious: paging.hasPrevious ?? false,
    refresh: async () => {},
    next: async () => {},
    previous: async () => {},
    inspect: async () => {},
    detailsAreCurrent: () => true,
    closeDetails: () => {},
  };
}
async function render(recovery: BufferReportRecoveryModel<BufferReportDisplay>) {
  await act(async () =>
    root.render(
      createElement(BufferReportRecoveryView, {
        recovery,
        reportKey: (row: BufferReportDisplay) => String(row.reportVersion),
      }),
    ),
  );
}
const text = () => container.textContent ?? "";

describe("earlier file reports empty pages", () => {
  it("says an empty continuation page needs nothing and points to the other pages", async () => {
    await render(model([], { hasNext: true }));
    expect(text()).toContain("No reports needing recovery on this page.");
    expect(text()).toContain("Use Next or Previous to check other pages.");
    expect(text()).not.toContain("No earlier reports on this page.");
  });
  it("calls a lone empty page empty instead of suggesting other pages", async () => {
    await render(model([]));
    expect(text()).toContain("No earlier reports on this page.");
    expect(text()).not.toContain("Use Next or Previous");
  });
  it("offers all reports when the page only has ones that need nothing", async () => {
    await render(model([report(1, false)], { hasNext: true }));
    expect(text()).toContain("No reports needing recovery on this page.");
    expect(text()).toContain("1 other reports on this page are available.");
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "Show all reports"),
    ).toBe(true);
  });
});
