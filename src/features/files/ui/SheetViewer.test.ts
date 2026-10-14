// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SheetViewer from "./SheetViewer";
import { loadSpreadsheet } from "../model/spreadsheetClient";
vi.mock("../model/spreadsheetClient", () => ({ loadSpreadsheet: vi.fn() }));
vi.mock("./documentZoom", () => ({
  useAnchoredZoom: () => ({ zoom: 1, reset: vi.fn() }),
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(loadSpreadsheet).mockResolvedValue({
    omittedSheets: 0,
    sheets: ["One", "Two"].map((name) => ({
      name,
      columns: ["A", "B"],
      rowCount: 100_000,
      totalRows: 100_000,
      totalColumns: 2,
      cells: { "0:0": "hello", "99999:1": "last" },
      truncated: false,
      budgetLimited: false,
    })),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("spreadsheet keyboard accessibility", () => {
  it("uses roving tabs and links the selected tab to its panel", async () => {
    await act(async () => root.render(createElement(SheetViewer, { bytes: new Uint8Array([1]) })));
    let tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect([...tabs].map((tab) => tab.tabIndex)).toEqual([0, -1]);
    tabs[0].focus();
    await act(async () => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    tabs = host.querySelectorAll('[role="tab"]');
    expect(document.activeElement).toBe(tabs[1]);
    expect([...tabs].map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(
      tabs[1].id,
    );
  });
  it("keeps active cells mounted and exposes their row/column context across virtual jumps", async () => {
    await act(async () => root.render(createElement(SheetViewer, { bytes: new Uint8Array([1]) })));
    const grid = host.querySelector<HTMLElement>('[role="grid"]')!;
    expect(grid.getAttribute("aria-readonly")).toBe("true");
    await act(async () => {
      grid.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    const cell = document.getElementById(grid.getAttribute("aria-activedescendant")!);
    expect(cell?.getAttribute("aria-label")).toBe("B100000: last");
    expect(cell?.getAttribute("aria-colindex")).toBe("3");
    expect(cell?.parentElement?.getAttribute("aria-rowindex")).toBe("100001");
    expect(host.querySelectorAll('[role="gridcell"]').length).toBeLessThan(100);
  });
});
