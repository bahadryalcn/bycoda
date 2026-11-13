// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkspaceStorageSummary } from "./WorkspaceStorageSummary";
import type { WorkspaceStorageStatus } from "../model/contracts";

it("keeps unknown storage distinct from a measured zero and shows the full Host root", () => {
  const storage: WorkspaceStorageStatus = {
    root: "/Host/مساحة-العمل/çok-uzun-proje/" + "long-unbroken-folder".repeat(15),
    materializedBytes: null,
    budgetBytes: 1000,
    warningRatio: 0.8,
    freeBytes: null,
    sharedCacheBytes: 0,
    recoveryBytes: 0,
    requiredFreeBytes: 100,
    minimumFreeBytes: 100,
    materialization: "allowed",
    missingPaths: [],
  };
  const render = (materializedBytes: number | null) =>
    renderToStaticMarkup(
      createElement(WorkspaceStorageSummary, {
        storage: { ...storage, materializedBytes },
        busy: false,
        disabled: false,
        stale: false,
        onRefresh: () => {},
      }),
    );
  const unknown = render(null);
  expect(unknown).toContain("Not measured");
  expect(unknown).not.toContain('role="meter"');
  expect(unknown).not.toContain('aria-valuenow="0"');
  expect(unknown).toContain(storage.root);
  expect(unknown).toContain('data-wrap="anywhere"');
  const zero = render(0);
  expect(zero).toContain('role="meter"');
  expect(zero).toContain('aria-valuenow="0"');
});
