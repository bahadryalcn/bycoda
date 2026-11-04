// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  recover: vi.fn(async (): Promise<unknown[]> => {
    throw new Error("agent recovery unavailable");
  }),
  claim: vi.fn(async (): Promise<unknown[]> => []),
  queue: vi.fn(async () => {}),
}));
vi.mock("../../../features/automations/model/automations", () => ({
  recoverAutomationRuns: api.recover,
  claimDueAutomations: api.claim,
}));
vi.mock("../../../features/connections/model/sshRunbookQueue", () => ({
  refreshSshRunbookQueue: api.queue,
}));
import { useAutomationRecovery } from "./useAutomationRecovery";

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

it("recovers nothing in a later window of the process and still launches the runs it claims", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Rust performs the recovery pass once per process; every later window's
  // call returns an empty list rather than cancelling runs live elsewhere.
  api.recover.mockResolvedValue([]);
  const automation = { id: "automation", prompt: "Review" };
  const run = { id: "run", automationId: "automation", status: "pending" };
  api.claim.mockResolvedValueOnce([{ automation, run }]).mockResolvedValue([]);
  const launch = vi.fn(async () => undefined);
  function Harness() {
    useAutomationRecovery({ launchAutomation: launch });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(api.recover).toHaveBeenCalledTimes(1);
    expect(api.recover.mock.calls[0]?.[0]).toBeTypeOf("number");
    expect(api.claim).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(automation, run);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    // Recovery is cached for the window's lifetime; only the scheduler repeats.
    expect(api.recover).toHaveBeenCalledTimes(1);
    expect(api.claim).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    api.recover.mockReset();
    api.recover.mockRejectedValue(new Error("agent recovery unavailable"));
    api.claim.mockReset();
    api.claim.mockResolvedValue([]);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
