// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DEFAULTS } from "../../tasks/model/hostSettings";
const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async () => ({ id: "local" }),
}));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../automations/public/hostMachines", () => ({
  machineCapabilities: async () => ["host.settings.behavior.v1"],
}));
vi.mock("../../../shared/ui/ToastRegion", () => ({ toast: { show: mocks.toast } }));
vi.mock("../../../shared/i18n/core", () => ({ t: (value: string) => value }));

const record = { agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version: 1 } };
let hidden: ReturnType<typeof vi.spyOn>;
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};
const reads = () => mocks.request.mock.calls.filter(([, method]) => method === "host.settings.get");

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.request.mockReset();
  mocks.request.mockResolvedValue(record);
  hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  hidden.mockRestore();
  vi.useRealTimers();
});

it("hydrates once on subscribe, backs off while unchanged and stops on unsubscribe", async () => {
  const settings = await import("./agentDefaults");
  const stop = settings.subscribeAgentDefaults(() => {});
  await settle();
  expect(reads()).toHaveLength(1);
  await settle(5000);
  expect(reads()).toHaveLength(2);
  await settle(9999);
  expect(reads()).toHaveLength(2);
  await settle(1);
  expect(reads()).toHaveLength(3);
  stop();
  await settle(120_000);
  expect(reads()).toHaveLength(3);
});

it("backs off while the Host is unreachable", async () => {
  mocks.request.mockRejectedValue(new Error("offline"));
  const settings = await import("./agentDefaults");
  const stop = settings.subscribeAgentDefaults(() => {});
  await settle();
  expect(reads()).toHaveLength(1);
  await settle(9999);
  expect(reads()).toHaveLength(1);
  await settle(1);
  expect(reads()).toHaveLength(2);
  stop();
});

it("hydrates while hidden, pauses polling, and catches up when shown or focused", async () => {
  hidden.mockReturnValue(true);
  const settings = await import("./agentDefaults");
  const stop = settings.subscribeAgentDefaults(() => {});
  await settle();
  expect(reads()).toHaveLength(1);
  await settle(300_000);
  expect(reads()).toHaveLength(1);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  expect(reads()).toHaveLength(2);
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(reads()).toHaveLength(3);
  hidden.mockReturnValue(true);
  await settle(300_000);
  expect(reads()).toHaveLength(3);
  stop();
});

it("keeps explicit saves working while polling is paused", async () => {
  hidden.mockReturnValue(true);
  const settings = await import("./agentDefaults");
  const stop = settings.subscribeAgentDefaults(() => {});
  await settle();
  mocks.request.mockImplementation(async (_id, method, params) =>
    method === "host.settings.save"
      ? {
          agentDefaults: {
            ...record.agentDefaults,
            ...params.settings.agentDefaults,
            version: 2,
          },
        }
      : record,
  );
  const saved = settings.saveAgentDefaultConfirmed("resumeAtReset", false);
  await settle();
  expect(await saved).toBe(true);
  expect(settings.loadAgentDefault("resumeAtReset")).toBe(false);
  stop();
});
