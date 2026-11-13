// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capabilities: vi.fn(),
  request: vi.fn(),
  resolve: vi.fn(),
  remoteMachine: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: mocks.capabilities,
}));
vi.mock("../../connections/model/localSync", () => ({
  isLocalSyncMachine: (machine: { id: string }) => machine.id === "local",
}));
vi.mock("../../connections/public/connections", () => ({
  remoteRequest: mocks.request,
  remoteMachineFor: mocks.remoteMachine,
}));
vi.mock("./modelRoutingClient", () => ({ resolveModelRouting: mocks.resolve }));
import { resolveHelperModel } from "./helperModelRouting";

const target = {
  harness: "codex" as const,
  model: "helper",
  providerAccountId: "account",
  modelSettings: { effort: "low" },
};
let state: ModelRoutingState;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state = {
    ...structuredClone(EMPTY_MODEL_ROUTING),
    version: 8,
    updatedAt: 12,
    defaultMaxRunMinutes: 30,
  };
  mocks.invoke.mockResolvedValue([{ id: "local" }]);
  mocks.capabilities.mockResolvedValue(["models.routing.v1"]);
  mocks.request.mockImplementation(async () => ({ state }));
  mocks.resolve.mockResolvedValue({ ok: true, target, source: { kind: "fixed" }, skipped: [] });
});
afterEach(() => vi.useRealTimers());

it("unbound helpers never follow the main order implicitly", async () => {
  expect(await resolveHelperModel("text.title")).toBeUndefined();
  expect(mocks.resolve).not.toHaveBeenCalled();
  state.roles["text.title"] = { kind: "order" };
  expect(await resolveHelperModel("text.title")).toEqual(target);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.request.mock.calls.every((call) => call[1] === "modelRouting.get")).toBe(true);
});

it.each(["notConfigured", "noEligibleEntry"])("falls back on %s", async (reason) => {
  state.roles["text.git"] = { kind: "order" };
  mocks.resolve.mockResolvedValue({ ok: false, reason, skipped: [] });
  expect(await resolveHelperModel("text.git")).toBeUndefined();
});

it("falls back without capability or on unreachable Host", async () => {
  mocks.capabilities.mockResolvedValue([]);
  expect(await resolveHelperModel("text.translation")).toBeUndefined();
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.invoke.mockRejectedValue(new Error("offline"));
  expect(await resolveHelperModel("text.translation")).toBeUndefined();
});

it("bounds the whole Host operation to 500ms and handles a late rejection", async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  mocks.invoke.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const result = resolveHelperModel("text.skillGrouping");
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toBeUndefined();
  reject(new Error("late offline"));
  await Promise.resolve();
});

it.each(["get", "resolve"])("bounds stalled %s to the same deadline", async (stage) => {
  vi.useFakeTimers();
  state.roles["text.title"] = { kind: "order" };
  if (stage === "get") mocks.request.mockReturnValue(new Promise(() => {}));
  if (stage === "resolve") mocks.resolve.mockReturnValue(new Promise(() => {}));
  const pending = resolveHelperModel("text.title");
  await vi.advanceTimersByTimeAsync(500);
  expect(await pending).toBeUndefined();
});
