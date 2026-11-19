// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { remoteRequest } from "../../connections/public/connections";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
import { startDelegationProfileSync, syncDelegationProfile } from "./delegationProfileSync";
import {
  loadGlobalSessionDefaults,
  saveGlobalSessionDefaults,
  saveAccountSessionDefaults,
  accountSessionDefaults,
  providerSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import { setProjectSessionDefaults } from "../../sessions/public/projectProviders";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("../../automations/model/machineSnapshot", () => ({ machineCapabilities: vi.fn() }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
const state = (): ModelRoutingState => ({
  ...structuredClone(EMPTY_MODEL_ROUTING),
  version: 2,
  updatedAt: 1,
});
beforeEach(() => localStorage.clear());

it("Host values win on start and subsequent updates, while project values stay chat-only", async () => {
  saveGlobalSessionDefaults("claude", {
    effort: "low",
    extras: { crossAdvisor: "stale", fast: "true" },
  });
  saveAccountSessionDefaults("claude", "work", { model: "sonnet", extras: { imageModels: "[]" } });
  setProjectSessionDefaults("/project", "claude", { extras: { crossSubagents: "[]" } });
  const remote = state();
  remote.delegation = {
    global: { crossAdvisor: "auto" },
    providers: { claude: { crossSubagentMaxEffort: "low" } },
    accounts: {},
  };
  await syncDelegationProfile(remote);
  expect(accountSessionDefaults("claude", "work")).toEqual({ model: "sonnet" });
  expect(providerSessionDefaults("claude", "/project").extras?.crossSubagents).toBe("[]");
  remote.version++;
  remote.delegation.providers.claude = { crossSubagentMaxEffort: "max" };
  await syncDelegationProfile(remote);
  expect(loadGlobalSessionDefaults().claude?.extras).toEqual({
    fast: "true",
    crossAdvisor: "auto",
    crossSubagentMaxEffort: "max",
  });
});

it("cleared Host settings suppress stale reserved recent values but preserve unrelated extras", async () => {
  localStorage.setItem(
    "bycoda.lastModelSettings",
    JSON.stringify({ crossSubagentMaxEffort: "max", subagentModel: "haiku", fast: "true" }),
  );
  await syncDelegationProfile(state());
  expect(providerSessionDefaults("claude").extras?.crossSubagentMaxEffort).toBeUndefined();
  expect(providerSessionDefaults("claude").extras?.subagentModel).toBeUndefined();
  expect(JSON.parse(localStorage.getItem("bycoda.lastModelSettings")!).fast).toBe("true");
});

/** A fresh module: the sync starts once per module, and recovery listeners live in remoteHealth. */
async function freshSync() {
  vi.resetModules();
  const [{ invoke: fresh }, caps, connections, sync, health, defaults] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("../../automations/model/machineSnapshot"),
    import("../../connections/public/connections"),
    import("./delegationProfileSync"),
    import("../../connections/model/remoteHealth"),
    import("../../sessions/public/providerSessionDefaults"),
  ]);
  return {
    invoke: vi.mocked(fresh),
    capabilities: vi.mocked(caps.machineCapabilities),
    request: vi.mocked(connections.remoteRequest),
    start: sync.startDelegationProfileSync,
    recover: health.announceRemoteRecovery,
    global: defaults.loadGlobalSessionDefaults,
  };
}
const localMachine = { id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" };
const routedState = (effort: "high" | "low"): ModelRoutingState => {
  const remote = state();
  remote.delegation.global = { crossSubagentMaxEffort: effort };
  return remote;
};

it("cold start: retries on the short backoff until the local Host answers, not after 60 s", async () => {
  vi.useFakeTimers();
  try {
    const sync = await freshSync();
    sync.invoke.mockResolvedValue([]);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.request).not.toHaveBeenCalled();
    sync.invoke.mockResolvedValue([localMachine]);
    sync.capabilities.mockResolvedValue(["models.routing.v1"]);
    sync.request.mockResolvedValue({ state: routedState("high") });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.request).toHaveBeenCalledTimes(1);
    expect(sync.global().claude?.extras?.crossSubagentMaxEffort).toBe("high");
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

it("a Host request that fails while booting is retried; backoff stops once it answered", async () => {
  vi.useFakeTimers();
  try {
    const sync = await freshSync();
    sync.invoke.mockResolvedValue([localMachine]);
    sync.capabilities.mockResolvedValue(["models.routing.v1"]);
    sync.request.mockRejectedValueOnce(new Error("Host is starting"));
    sync.request.mockResolvedValue({ state: routedState("low") });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.request).toHaveBeenCalledTimes(2);
    expect(sync.global().claude?.extras?.crossSubagentMaxEffort).toBe("low");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sync.request).toHaveBeenCalledTimes(2);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

it("after the backoff is spent a recovery report refreshes at once", async () => {
  vi.useFakeTimers();
  try {
    const sync = await freshSync();
    sync.invoke.mockResolvedValue([]);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    // Past every backoff step the attempts are spent; the 60 s poll still finds no machine.
    sync.request.mockResolvedValue({ state: routedState("high") });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sync.request).not.toHaveBeenCalled();
    sync.invoke.mockResolvedValue([localMachine]);
    sync.capabilities.mockResolvedValue(["models.routing.v1"]);
    sync.recover("local-env");
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.request).toHaveBeenCalledTimes(1);
    expect(sync.global().claude?.extras?.crossSubagentMaxEffort).toBe("high");
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

it("startup waits for capability, then refreshes Host changes while Settings stays closed", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(invoke).mockResolvedValue([
      { id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" },
    ]);
    vi.mocked(machineCapabilities).mockResolvedValue([]);
    startDelegationProfileSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).not.toHaveBeenCalled();
    vi.mocked(machineCapabilities).mockResolvedValue(["models.routing.v1"]);
    const remote = state();
    remote.delegation.global = { crossSubagentMaxEffort: "high" };
    vi.mocked(remoteRequest).mockResolvedValue({ state: remote });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loadGlobalSessionDefaults().claude?.extras?.crossSubagentMaxEffort).toBe("high");
    remote.version++;
    remote.delegation.global = { crossSubagentMaxEffort: "low" };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loadGlobalSessionDefaults().claude?.extras?.crossSubagentMaxEffort).toBe("low");
    expect(
      vi.mocked(remoteRequest).mock.calls.every((call) => call[1] === "modelRouting.get"),
    ).toBe(true);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
