import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  models: [{ id: "a" }] as unknown[],
  live: false,
  refresh: vi.fn(async (_ids: unknown, _options?: unknown) => undefined as void),
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: (ids: unknown, options?: unknown) => state.refresh(ids, options),
}));
vi.mock("../../sessions/model/models", () => ({
  catalogModelsFor: () => state.models,
  hasLiveCatalog: () => state.live,
}));

import {
  getCatalogReceipt,
  getCatalogReceiptsSnapshot,
  refreshProviderCatalog,
  resetCatalogReceipts,
} from "./catalogReceipts";

describe("catalog receipts", () => {
  beforeEach(() => {
    state.models = [{ id: "a" }];
    state.live = false;
    state.refresh.mockReset();
    state.refresh.mockResolvedValue(undefined);
    resetCatalogReceipts();
  });

  it("calls a replaced list fresh", async () => {
    state.refresh.mockImplementation(async () => {
      state.models = [{ id: "a" }, { id: "b" }];
      state.live = true;
    });
    const before = getCatalogReceiptsSnapshot();
    const receipt = await refreshProviderCatalog("codex", { force: true });
    expect(receipt).toMatchObject({ status: "fresh", count: 2 });
    expect(state.refresh).toHaveBeenCalledWith(["codex"], { force: true });
    expect(getCatalogReceipt("codex")).toBe(receipt);
    expect(getCatalogReceiptsSnapshot()).toBeGreaterThan(before);
  });

  it("does not claim freshness when an earlier live list is kept", async () => {
    state.live = true;
    await expect(refreshProviderCatalog("claude")).resolves.toMatchObject({ status: "retained" });
  });

  it("reports the bundled list when no live list exists", async () => {
    await expect(refreshProviderCatalog("claude")).resolves.toMatchObject({
      status: "bundled",
      count: 1,
    });
  });

  it("keeps the shown count and error when the refresh rejects", async () => {
    state.live = true;
    state.refresh.mockRejectedValue(new Error("spawn failed"));
    await expect(refreshProviderCatalog("cursor")).resolves.toMatchObject({
      status: "error",
      error: "spawn failed",
      retained: true,
      count: 1,
    });
  });

  it("shares one attempt and exposes refreshing with the previous receipt", async () => {
    await refreshProviderCatalog("grok");
    let finish!: () => void;
    state.refresh.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = refreshProviderCatalog("grok");
    const second = refreshProviderCatalog("grok");
    expect(second).toBe(first);
    expect(getCatalogReceipt("grok")).toMatchObject({
      status: "refreshing",
      previous: { status: "bundled" },
    });
    finish();
    await first;
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });
});
