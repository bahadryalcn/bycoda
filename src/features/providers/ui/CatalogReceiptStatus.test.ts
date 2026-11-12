// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CatalogReceipt } from "../model/catalogReceipts";
const state = vi.hoisted(() => ({ receipt: undefined as CatalogReceipt | undefined }));
vi.mock("../model/catalogReceipts", () => ({
  getCatalogReceipt: () => state.receipt,
  getCatalogReceiptsSnapshot: () => 0,
  subscribeCatalogReceipts: () => () => {},
  refreshProviderCatalog: vi.fn(async () => undefined),
}));
import { CatalogReceiptStatus, CatalogRefreshButton } from "./CatalogReceiptStatus";
it("keeps usable unchanged catalogs quiet, retains real errors and exposes refresh provenance", async () => {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    for (const status of ["fresh", "retained"] as const) {
      state.receipt = { status, at: 100, count: 13 };
      await act(async () =>
        root.render(createElement(CatalogReceiptStatus, { harness: "claude", available: true })),
      );
      expect(node.textContent).toBe("");
      expect(node.children).toHaveLength(0);
    }
    for (const retained of [true, false]) {
      state.receipt = {
        status: "error",
        at: 100,
        count: 13,
        error: "CLI discovery failed",
        retained,
      };
      await act(async () =>
        root.render(createElement(CatalogReceiptStatus, { harness: "claude", available: true })),
      );
      expect(node.textContent).toContain("CLI discovery failed");
      expect(node.textContent).toContain(retained ? "earlier list" : "built-in list");
      expect(node.textContent).toContain("Retry");
    }
    await act(async () => root.render(createElement(CatalogRefreshButton, { harness: "claude" })));
    expect(node.querySelector("button")?.getAttribute("aria-label")).toBe("Refresh");
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
