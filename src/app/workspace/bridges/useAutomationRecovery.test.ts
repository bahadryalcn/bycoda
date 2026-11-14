// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  recover: vi.fn(async (): Promise<never[]> => {
    throw new Error("agent recovery unavailable");
  }),
  claim: vi.fn(async () => []),
  queue: vi.fn(async () => {}),
  lead: vi.fn(async () => true),
}));
vi.mock("../../../platform/tauri/workspaceWindows", () => ({ isLeadWindow: api.lead }));
vi.mock("../../../features/automations/model/automations", () => ({
  recoverAutomationRuns: api.recover,
  claimDueAutomations: api.claim,
}));
vi.mock("../../../features/connections/model/sshRunbookQueue", () => ({
  refreshSshRunbookQueue: api.queue,
}));
import { useAutomationRecovery, type AutomationRecoveryDeps } from "./useAutomationRecovery";

it("polls SSH review metadata independently of agent recovery, retries on visibility, and stops on unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const launch = vi.fn();
  function Harness() {
    useAutomationRecovery({ launchAutomation: launch });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(api.queue).toHaveBeenCalledTimes(1);
    expect(api.claim).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(api.queue).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(api.queue).toHaveBeenCalledTimes(3);
    expect(launch).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(api.queue).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("does not claim due work after disposal while recovery was pending", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  let finish!: () => void;
  api.recover.mockImplementationOnce(
    () =>
      new Promise<never[]>((resolve) => {
        finish = () => resolve([]);
      }),
  );
  const launch = vi.fn();
  function Harness() {
    useAutomationRecovery({ launchAutomation: launch });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(api.recover).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    await act(async () => finish());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.claim).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("lets only the replacement scheduler claim after their shared recovery completes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  let finish!: () => void;
  api.recover.mockImplementationOnce(
    () =>
      new Promise<never[]>((resolve) => {
        finish = () => resolve([]);
      }),
  );
  function Harness(deps: AutomationRecoveryDeps) {
    useAutomationRecovery(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness, { launchAutomation: vi.fn() })));
    await act(async () => root.render(createElement(Harness, { launchAutomation: vi.fn() })));
    expect(api.recover).toHaveBeenCalledOnce();
    expect(api.claim).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(api.claim).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
