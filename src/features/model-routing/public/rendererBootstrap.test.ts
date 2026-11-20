import { afterEach, expect, it, vi } from "vitest";

const { start, refreshFacts, bindCatalog, models, account } = vi.hoisted(() => ({
  start: vi.fn(),
  refreshFacts: vi.fn(async () => undefined),
  bindCatalog: vi.fn(),
  models: vi.fn(() => [{ id: "codex:live" }, { id: "codex:disabled" }]),
  account: vi.fn(() => "work"),
}));
vi.mock("../../../integrations/harness/core/automaticSubagents", () => ({
  setAutomaticSubagentCatalogReader: bindCatalog,
}));
vi.mock("../../sessions/public/models", () => ({
  modelsFor: models,
  isModelEnabled: (id: string) => !id.endsWith(":disabled"),
}));
vi.mock("../../providers/public/providerAccounts", () => ({
  defaultProviderAccountId: account,
}));
vi.mock("./delegation", () => ({
  startDelegationProfileSync: start,
}));

vi.mock("../model/liveCatalogFacts", () => ({
  startLocalLiveCatalogFactsSync: refreshFacts,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refreshFacts.mockClear();
  vi.resetModules();
  start.mockClear();
  bindCatalog.mockClear();
  models.mockClear();
  account.mockClear();
});

it("keeps renderer polling out of a headless runtime", async () => {
  vi.stubGlobal("window", undefined);
  await import("./rendererBootstrap");
  expect(start).not.toHaveBeenCalled();
  expect(refreshFacts).not.toHaveBeenCalled();
});

it("leaves a browser fixture without a native bridge alone", async () => {
  vi.stubGlobal("window", {});
  await import("./rendererBootstrap");
  expect(start).not.toHaveBeenCalled();
});

it("starts native renderer polling once, after the mounted surface has painted", async () => {
  const frame = vi.fn<(callback: () => void) => number>(() => 1);
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, requestAnimationFrame: frame });
  const { startRendererModelRoutingAfterPaint } = await import("./rendererBootstrap");
  expect(start).not.toHaveBeenCalled();
  expect(frame).not.toHaveBeenCalled();
  startRendererModelRoutingAfterPaint();
  frame.mock.calls[0][0]();
  expect(start).not.toHaveBeenCalled();
  expect(refreshFacts).not.toHaveBeenCalled();
  frame.mock.calls[1][0]();
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(refreshFacts).toHaveBeenCalledOnce());
  startRendererModelRoutingAfterPaint();
  expect(frame).toHaveBeenCalledTimes(2);
});

it("binds live enabled-model and default-account readers before startup", async () => {
  vi.stubGlobal("window", {});
  await import("./rendererBootstrap");
  expect(bindCatalog).toHaveBeenCalledOnce();
  expect(models).not.toHaveBeenCalled();
  const read = bindCatalog.mock.calls[0][0];
  expect(read().models).toContainEqual({ id: "codex:live", harness: "codex" });
  expect(read().models.some((model: { id: string }) => model.id.endsWith(":disabled"))).toBe(false);
  expect(read().defaultAccounts).toEqual({ claude: "work", codex: "work" });
  account.mockReturnValueOnce("personal");
  expect(read().defaultAccounts.claude).toBe("personal");
});
