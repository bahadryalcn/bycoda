// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => {
  const lead = vi.fn(async () => true);
  const peer = { listen: vi.fn(async (_event: string, _handler: () => void) => () => {}) };
  return {
    recover: vi.fn(async (): Promise<never[]> => {
      throw new Error("agent recovery unavailable");
    }),
    claim: vi.fn(async () => []),
    queue: vi.fn(async () => {}),
    lead,
    peer,
    elect: vi.fn(async () => ({ leader: await lead(), lead: peer })),
  };
});
vi.mock("../../../platform/tauri/workspaceWindows", () => ({ electLeadWindow: api.elect }));
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

it("survives a hung leader check and awaits a stalled due claim instead of claiming twice", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  api.recover.mockResolvedValue([]);
  api.lead.mockImplementationOnce(() => new Promise<boolean>(() => {})).mockResolvedValue(true);
  let release!: (runs: unknown[]) => void;
  api.claim.mockImplementationOnce(
    () =>
      new Promise<never[]>((resolve) => {
        release = resolve as (runs: unknown[]) => void;
      }),
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const launch = vi.fn(async () => {});
  function Harness() {
    useAutomationRecovery({ launchAutomation: launch });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(api.claim).not.toHaveBeenCalled();
    // The leader check times out; the next tick evaluates again and its claim stalls.
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(api.claim).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(warn).toHaveBeenCalledWith("Automation scheduler tick failed", expect.any(Error));
    // The following tick reuses the in-flight claim and launches its run once.
    await act(async () => {
      release([{ automation: { id: "automation" }, run: { id: "run" } }]);
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.claim).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    warn.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("skips non-leading ticks, re-elects when the lead is destroyed, and keeps a slow fallback census", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  api.recover.mockResolvedValue([]);
  api.lead.mockResolvedValue(false);
  let onLeadDestroyed: () => void = () => {};
  const unlisten = vi.fn();
  api.peer.listen.mockImplementationOnce(async (_event, handler) => {
    onLeadDestroyed = handler;
    return unlisten;
  });
  function Harness() {
    useAutomationRecovery({ launchAutomation: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(api.elect).toHaveBeenCalledTimes(1);
    expect(api.peer.listen).toHaveBeenCalledWith("tauri://destroyed", expect.any(Function));
    expect(api.queue).not.toHaveBeenCalled();
    // Four minutes of 30s ticks cost no census in a non-leading window.
    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000));
    expect(api.elect).toHaveBeenCalledTimes(1);
    // The slow fallback census still catches a lead that vanished without an event.
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.elect).toHaveBeenCalledTimes(2);
    // Lead destroyed: this window re-elects at once and takes over the scheduler.
    api.lead.mockResolvedValue(true);
    await act(async () => onLeadDestroyed());
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(api.elect).toHaveBeenCalledTimes(3);
    expect(api.queue).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    api.lead.mockResolvedValue(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
