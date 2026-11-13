import { afterEach, expect, it, vi } from "vitest";

const { start, bindCatalog, models, account } = vi.hoisted(() => ({
  start: vi.fn(),
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

afterEach(() => {
  vi.unstubAllGlobals();
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
});

it("leaves a browser fixture without a native bridge alone", async () => {
  vi.stubGlobal("window", {});
  await import("./rendererBootstrap");
  expect(start).not.toHaveBeenCalled();
});

it("starts native renderer polling once per module initialization", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  await import("./rendererBootstrap");
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  await import("./rendererBootstrap");
  expect(start).toHaveBeenCalledOnce();
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
