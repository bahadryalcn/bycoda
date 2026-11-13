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
