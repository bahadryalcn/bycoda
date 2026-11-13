// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FileLoadError } from "./FileLoadError";
import { SheetGridView } from "./SheetGridView";
import { BinaryFileView } from "./BinaryFileView";

vi.mock("../../../shared/i18n/technical", () => ({
  t: (message: string) => `localized:${message}`,
  useLocale: () => "tr",
}));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false, IS_WIN: true }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  readBinaryFile: async () => new Uint8Array(),
}));
vi.mock("../model/fileWatch", () => ({ watchFile: () => () => {} }));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("./documentZoom", () => ({ useAnchoredZoom: () => ({ zoom: 1, reset: vi.fn() }) }));

it("translates native reveal actions and empty-cell accessible names", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(FileLoadError, {
          path: "C:/project/file.txt",
          message: "read denied",
          onRetry: vi.fn(),
        }),
      ),
    );
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "localized:Reveal in File Explorer",
      ),
    ).toBe(true);
    await act(async () =>
      root.render(
        createElement(SheetGridView, {
          grid: {
            name: "Çalışma 📊",
            columns: ["A"],
            rowCount: 1,
            totalRows: 1,
            totalColumns: 1,
            cells: {},
            truncated: false,
            budgetLimited: false,
          },
        }),
      ),
    );
    expect(host.querySelector('[role="gridcell"]')?.getAttribute("aria-label")).toBe(
      "A1: localized:Empty cell",
    );
    await act(async () =>
      root.render(
        createElement(BinaryFileView, { path: "C:/project/unsupported.png", cwd: "C:/project" }),
      ),
    );
    expect(host.textContent).toContain("localized:{p0} is not a readable image.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
