import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DEFAULTS } from "../../tasks/model/hostSettings";
const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async () => ({ id: "local" }),
}));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: async () => ["host.settings.behavior.v1"],
}));
vi.mock("../../../shared/ui/ToastRegion", () => ({ toast: { show: mocks.toast } }));
vi.mock("../../../shared/i18n/core", () => ({ t: (value: string) => value }));
beforeEach(() => {
  vi.resetModules();
  mocks.request.mockReset();
  mocks.toast.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("migrates legacy values only when the Host version is zero", async () => {
  localStorage.setItem("bycoda.keepAwakeWhileAgentsWork", "1");
  localStorage.setItem("bycoda.streamingTextMode", "adaptive");
  mocks.request
    .mockResolvedValueOnce({ agentDefaults: DEFAULT_AGENT_DEFAULTS })
    .mockImplementationOnce(async (_id, _method, params) => ({
      agentDefaults: { ...params.settings.agentDefaults, version: 1 },
    }));
  const settings = await import("./agentDefaults");
  await settings.initializeAgentDefaults();
  expect(mocks.request.mock.calls[1]?.[2].settings).toMatchObject({
    migrateAgentDefaults: true,
    expectedAgentDefaultsVersion: 0,
    agentDefaults: { keepAwakeWhileAgentsWork: true, streamingTextMode: "adaptive" },
  });
  expect(settings.loadAgentDefault("keepAwakeWhileAgentsWork")).toBe(true);
  mocks.request.mockResolvedValue({
    agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version: 2, resumeAtReset: false },
  });
  await settings.initializeAgentDefaults();
  expect(mocks.request).toHaveBeenCalledTimes(3);
  expect(settings.loadAgentDefault("resumeAtReset")).toBe(false);
});
it("preserves confirmed state on rejected saves and reports failure", async () => {
  mocks.request.mockResolvedValue({ agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version: 1 } });
  const settings = await import("./agentDefaults");
  await settings.initializeAgentDefaults();
  mocks.request.mockImplementation(async (_id, method) => {
    if (method === "host.settings.save") throw new Error("Conflict");
    return { agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version: 1 } };
  });
  expect(await settings.saveAgentDefaultConfirmed("resumeAtReset", false)).toBe(false);
  expect(settings.loadAgentDefault("resumeAtReset")).toBe(true);
  expect(mocks.toast).toHaveBeenCalledOnce();
});
