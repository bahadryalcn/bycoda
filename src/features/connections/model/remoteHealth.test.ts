// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  forgetRemoteConnection,
  notifyRemoteRecovered,
  readRemoteConnection,
  remotePollDue,
  reportRemoteLoad,
  resetRemoteConnection,
  resetRemoteHealth,
  subscribeRemoteRecovered,
  TIMEOUTS_BEFORE_UNREACHABLE,
} from "./remoteHealth";
import { monotonicNow } from "../../../shared/lib/time/timestamps";
import { remotePath } from "./remoteProjects";
import { setMachineEnabled } from "./machineEnabled";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  useRemoteLoadFailure,
  recordRemoteConnection,
  reportRemoteConnection,
} from "./remoteHealth";
import { blocksSending, connectionIndicator, shouldAutoRetry } from "./remoteConnection";
import {
  adoptRemoteMachineInventory,
  reportRemoteMachineStatus,
  remoteRequest,
} from "./connections";
import type { RemoteMachine } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const project = remotePath("env", "/Users/me/repo");
const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  // Poll delays run on the monotonic clock; keep it moving with the fake timers.
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  resetRemoteHealth();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("skips background polls for disabled machines, including healthy direct routes", () => {
  setMachineEnabled("env", false);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(60_000);
  expect(remotePollDue(project)).toBe(false);
  setMachineEnabled("env", true);
  expect(remotePollDue(project)).toBe(true);
});

it("slows polling while unreachable and resumes after one success", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  expect(remotePollDue(project)).toBe(true);

  reportRemoteLoad(project, "changes", down);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(14_999);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(1);
  expect(remotePollDue(project)).toBe(true);

  // A second failure in a row backs off further, to 30 seconds.
  reportRemoteLoad(project, "graph", down);
  vi.advanceTimersByTime(29_999);
  expect(remotePollDue(project)).toBe(false);
  vi.advanceTimersByTime(1);
  expect(remotePollDue(project)).toBe(true);

  reportRemoteLoad(project, "files");
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).toHaveBeenCalledTimes(1);
  // Successes while healthy are not recoveries.
  reportRemoteLoad(project, "files");
  expect(recovered).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it("treats an error from the machine itself as proof it is reachable", () => {
  reportRemoteLoad(project, "changes", down);
  expect(remotePollDue(project)).toBe(false);
  reportRemoteLoad(project, "graph", "Host rejected request: Not a working copy");
  expect(remotePollDue(project)).toBe(true);
});

it("does not read a refusal of a turned-off machine as an answer", () => {
  const refused = Object.assign(new Error("Machine connection is disabled"), {
    code: "RPC_WS_DISABLED",
  });
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  reportRemoteLoad(project, "changes", down);
  const before = readRemoteConnection("env");
  expect(before.status).toBe("unreachable");

  vi.advanceTimersByTime(1_000);
  reportRemoteLoad(project, "graph", refused);
  reportRemoteConnection(project, "status", refused);
  recordRemoteConnection("env", refused);

  // No recovery, no Connected, no fresh lastSeen, and the outage backoff stays.
  expect(readRemoteConnection("env")).toBe(before);
  expect(recovered).not.toHaveBeenCalled();
  expect(remotePollDue(project)).toBe(false);
  unsubscribe();
});

it("keeps an unknown machine connecting when its requests are refused as turned off", () => {
  recordRemoteConnection("env", "RPC_WS_DISABLED: Machine connection is disabled");
  reportRemoteConnection(project, "status", "Machine connection is disabled");
  expect(readRemoteConnection("env")).toMatchObject({ status: "connecting" });
  expect(readRemoteConnection("env").lastSeen).toBeUndefined();
});

it("still recovers when a turned-on machine answers after refusals", () => {
  const refused = Object.assign(new Error("Machine connection is disabled"), {
    code: "RPC_WS_DISABLED",
  });
  reportRemoteLoad(project, "changes", down);
  reportRemoteLoad(project, "graph", refused);
  reportRemoteLoad(project, "files");
  expect(readRemoteConnection("env").status).toBe("connected");
  expect(remotePollDue(project)).toBe(true);
});

it("resumes immediately after a reconnect", () => {
  const recovered = vi.fn();
  subscribeRemoteRecovered(recovered);
  reportRemoteLoad(project, "changes", down);
  notifyRemoteRecovered();
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).toHaveBeenCalledTimes(1);
});

it("never records or slows local projects", () => {
  reportRemoteLoad("/Users/me/repo", "changes", down);
  expect(remotePollDue("/Users/me/repo")).toBe(true);
  expect(remotePollDue(project)).toBe(true);
});

it("keeps one connection status per machine, fed by every view's loads", () => {
  expect(readRemoteConnection("env").status).toBe("connecting");
  reportRemoteLoad(project, "files");
  expect(readRemoteConnection("env").status).toBe("connected");
  reportRemoteLoad(project, "changes", down);
  expect(readRemoteConnection("env")).toMatchObject({ status: "unreachable" });
  expect(readRemoteConnection("other").status).toBe("connecting");
  reportRemoteLoad(project, "graph");
  expect(readRemoteConnection("env").status).toBe("connected");
  // A host that is too old stays flagged until it is reconnected or updated.
  reportRemoteLoad(project, "changes", "Host rejected request: Unsupported workspace command");
  reportRemoteLoad(project, "files");
  expect(readRemoteConnection("env").status).toBe("outdated-host");
  notifyRemoteRecovered("env");
  expect(readRemoteConnection("env").status).toBe("connected");
});

it("starts a machine's connection over when its address is edited", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  reportRemoteLoad(project, "changes", down);
  expect(readRemoteConnection("env").status).toBe("unreachable");
  expect(remotePollDue(project)).toBe(false);
  resetRemoteConnection("env");
  expect(readRemoteConnection("env")).toEqual({ status: "connecting" });
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).not.toHaveBeenCalled();
  unsubscribe();
});

it("keeps another machine's subscribed banner and backoff after a scoped reconnect", async () => {
  const other = remotePath("env-other", "/repo");
  reportRemoteLoad(project, "files", down);
  reportRemoteLoad(other, "files", down);
  let visible: ReturnType<typeof useRemoteLoadFailure>;
  const element = document.createElement("div");
  const root = createRoot(element);
  function View() {
    visible = useRemoteLoadFailure(other, "files");
    return null;
  }
  try {
    await act(async () => root.render(createElement(View)));
    const original = visible;
    await act(async () => notifyRemoteRecovered("env"));
    expect(visible).toBe(original);
    expect(visible?.kind).toBe("unreachable");
    expect(remotePollDue(project)).toBe(true);
    expect(remotePollDue(other)).toBe(false);
    expect(readRemoteConnection("env-other").status).toBe("unreachable");
    await act(async () => notifyRemoteRecovered());
    expect(visible).toBeUndefined();
    expect(remotePollDue(other)).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a refused host identity actionable and blocks sends until verified recovery", () => {
  const refusal = "Host identity changed. Add this machine again before continuing.";
  recordRemoteConnection("env", down);
  reportRemoteConnection(project, "files", new Error(refusal));
  const state = readRemoteConnection("env");
  expect(state).toMatchObject({ status: "identity-mismatch", error: refusal });
  expect(connectionIndicator(state, false)).toEqual({
    tone: "down",
    label: `Not connected. ${refusal}`,
  });
  expect(blocksSending(state.status)).toBe(true);
  expect(shouldAutoRetry(state.status, undefined, Date.now())).toBe(false);
  recordRemoteConnection("env");
  recordRemoteConnection("env", down);
  expect(readRemoteConnection("env")).toBe(state);
  notifyRemoteRecovered("env");
  expect(readRemoteConnection("env").status).toBe("connected");
});

it("does not treat a busy or timed-out host as reachable", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  const busy = Object.assign(new Error("RPC_WS_DEADLINE: The machine did not answer in time"), {
    code: "RPC_WS_DEADLINE",
  });
  reportRemoteLoad(project, "changes", down);
  reportRemoteLoad(project, "graph", busy);
  expect(remotePollDue(project)).toBe(false);
  expect(recovered).not.toHaveBeenCalled();
  reportRemoteLoad(project, "files", "Host rejected request: Not a working copy");
  expect(remotePollDue(project)).toBe(true);
  expect(recovered).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it.each(["RPC_WS_DEADLINE: timed out", "RPC_WS_OVERLOAD: busy", "[RPC_TIMEOUT]"])(
  "does not announce recovery from a connection-only report of %s",
  (error) => {
    const recovered = vi.fn();
    const unsubscribe = subscribeRemoteRecovered(recovered);
    reportRemoteConnection(project, "session", down);
    reportRemoteConnection(project, "session", error);
    expect(readRemoteConnection("env").status).toBe("unreachable");
    expect(remotePollDue(project)).toBe(false);
    expect(recovered).not.toHaveBeenCalled();
    unsubscribe();
  },
);

it("keeps a blocked machine blocked when a status poll finds it answering", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  adoptRemoteMachineInventory([{ id: "m1", environmentId: "env" } as RemoteMachine]);
  const blocked = Object.assign(new Error("RPC_WS_BLOCKED: Host authentication was refused"), {
    code: "RPC_WS_BLOCKED",
  });
  recordRemoteConnection("env", blocked);
  expect(readRemoteConnection("env").status).toBe("connection-blocked");
  reportRemoteMachineStatus("m1", false, down);
  expect(readRemoteConnection("env").status).toBe("connection-blocked");
  reportRemoteMachineStatus("m1", true);
  expect(readRemoteConnection("env").status).toBe("connection-blocked");
  // Views still reload, so they can show what the machine now answers.
  expect(recovered).toHaveBeenCalledWith("env");
  unsubscribe();
});

it.each(["Host rejected request: Host read capacity is busy", "[RPC_TIMEOUT]"])(
  "does not mark a machine offline, or recover it later, for one temporary status failure (%s)",
  (busy) => {
    const recovered = vi.fn();
    const unsubscribe = subscribeRemoteRecovered(recovered);
    adoptRemoteMachineInventory([{ id: "busy-m", environmentId: "busy-env" } as RemoteMachine]);
    reportRemoteMachineStatus("busy-m", false, busy);
    reportRemoteMachineStatus("busy-m", true);
    expect(recovered).not.toHaveBeenCalled();
    expect(readRemoteConnection("busy-env").status).toBe("connected");
    unsubscribe();
  },
);

it("still marks a machine offline on an authoritative failure and recovers it once it answers", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  adoptRemoteMachineInventory([{ id: "down-m", environmentId: "down-env" } as RemoteMachine]);
  reportRemoteMachineStatus("down-m", true);
  reportRemoteMachineStatus("down-m", false, down);
  expect(readRemoteConnection("down-env").status).toBe("unreachable");
  reportRemoteMachineStatus("down-m", true);
  expect(recovered).toHaveBeenCalledTimes(1);
  expect(recovered).toHaveBeenCalledWith("down-env");
  unsubscribe();
});

it("marks a machine offline once a run of timeouts made its connection unreachable", () => {
  const recovered = vi.fn();
  const unsubscribe = subscribeRemoteRecovered(recovered);
  adoptRemoteMachineInventory([{ id: "slow-m", environmentId: "slow-env" } as RemoteMachine]);
  reportRemoteMachineStatus("slow-m", true);
  for (let attempt = 0; attempt < TIMEOUTS_BEFORE_UNREACHABLE; attempt++) {
    vi.advanceTimersByTime(1);
    recordRemoteConnection("slow-env", "[RPC_TIMEOUT]", { startedAt: monotonicNow() });
    reportRemoteMachineStatus("slow-m", false, "[RPC_TIMEOUT]");
    vi.advanceTimersByTime(1);
    // Two timeouts are no evidence yet; the third one is.
    expect(recovered).not.toHaveBeenCalled();
  }
  expect(readRemoteConnection("slow-env").status).toBe("unreachable");
  reportRemoteMachineStatus("slow-m", true);
  expect(recovered).toHaveBeenCalledWith("slow-env");
  unsubscribe();
});

it("forgets a removed machine's connection, failure and backoff", () => {
  reportRemoteLoad(project, "changes", down);
  expect(readRemoteConnection("env").status).toBe("unreachable");
  forgetRemoteConnection("env");
  expect(readRemoteConnection("env")).toEqual({ status: "connecting" });
  expect(remotePollDue(project)).toBe(true);
});

it("records RPC transport failures and recovery without requiring a pane reporter", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  adoptRemoteMachineInventory([{ id: "rpc-health", environmentId: "rpc-env" } as RemoteMachine]);
  vi.mocked(invoke).mockRejectedValueOnce({
    message: "The host request did not complete [RPC_HOST_UNAVAILABLE] (environment.describe).",
  });
  await expect(remoteRequest("rpc-health", "environment.describe")).rejects.toMatchObject({
    message: expect.stringContaining("RPC_HOST_UNAVAILABLE"),
  });
  expect(readRemoteConnection("rpc-env").status).toBe("unreachable");
  vi.mocked(invoke).mockResolvedValueOnce({ environmentId: "rpc-env" });
  await remoteRequest("rpc-health", "environment.describe");
  expect(readRemoteConnection("rpc-env").status).toBe("connected");
});

it("lists machines in an outage and notifies subscribers, without any pane", async () => {
  const { listRemoteOutages, subscribeChanges } = await import("./remoteHealth");
  const seen: string[][] = [];
  const stop = subscribeChanges(() => seen.push(listRemoteOutages()));
  expect(listRemoteOutages()).toEqual([]);
  recordRemoteConnection("a", new Error(down));
  recordRemoteConnection("b", undefined);
  expect(listRemoteOutages()).toEqual(["a"]);
  notifyRemoteRecovered("a");
  expect(listRemoteOutages()).toEqual([]);
  expect(seen.some((ids) => ids.includes("a"))).toBe(true);
  stop();
});

it("times the unreachable poll backoff on the monotonic clock, so a wall-clock change does not stall polls", () => {
  let monotonic = 0;
  vi.mocked(performance.now).mockImplementation(() => monotonic);
  vi.setSystemTime(10_000_000);
  reportRemoteLoad(project, "changes", down);
  expect(remotePollDue(project)).toBe(false);
  // The wall clock jumps an hour back while no time passes on the monotonic clock.
  vi.setSystemTime(10_000_000 - 3_600_000);
  expect(remotePollDue(project)).toBe(false);
  monotonic = 15_000;
  expect(remotePollDue(project)).toBe(true);
});

it("keeps an outdated Host out of the outage list and times an outage from its first failure", async () => {
  const { listRemoteOutages, readRemoteDownSince } = await import("./remoteHealth");
  recordRemoteConnection("old", "Unsupported host method: git.status");
  expect(readRemoteConnection("old").status).toBe("outdated-host");
  expect(listRemoteOutages()).toEqual([]);
  vi.setSystemTime(1_000);
  recordRemoteConnection("env", down);
  vi.setSystemTime(90_000);
  recordRemoteConnection("env", down);
  expect(listRemoteOutages()).toEqual(["env"]);
  expect(readRemoteDownSince("env")).toBe(1_000);
  recordRemoteConnection("env");
  expect(readRemoteDownSince("env")).toBeUndefined();
});

const deadline = Object.assign(new Error("RPC_WS_DEADLINE: The machine did not answer in time"), {
  code: "RPC_WS_DEADLINE",
});

/** One request that began now, waited out its deadline and timed out. */
function timeOutSequentially(environmentId = "env") {
  const startedAt = performance.now();
  vi.advanceTimersByTime(10_000);
  recordRemoteConnection(environmentId, deadline, { startedAt });
}

it("marks a machine that only times out unreachable after a run of timeouts", () => {
  // A view repeating a timeout the request path already recorded counts nothing.
  reportRemoteConnection(project, "session", "Host rejected request: [RPC_TIMEOUT] slow");
  reportRemoteConnection(project, "session", deadline);
  timeOutSequentially();
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("connecting");
  timeOutSequentially();
  const state = readRemoteConnection("env");
  expect(state.status).toBe("unreachable");
  expect(state.error).toBe("The machine did not answer. It may be off, asleep or offline.");
  expect(shouldAutoRetry(state.status, undefined, Date.now())).toBe(true);
  // More timeouts keep the same state.
  timeOutSequentially();
  timeOutSequentially();
  timeOutSequentially();
  expect(readRemoteConnection("env")).toBe(state);
});

it("counts requests that stalled together as one timeout, not a run", () => {
  recordRemoteConnection("env");
  // A busy Host fails four requests that were all in flight when it stalled.
  const startedAt = performance.now();
  vi.advanceTimersByTime(10_000);
  for (let i = 0; i < 4; i += 1) recordRemoteConnection("env", deadline, { startedAt });
  expect(readRemoteConnection("env").status).toBe("connected");
  // Requests that began during the stall, before the first timeout resolved, are part of it.
  recordRemoteConnection("env", deadline, { startedAt: startedAt + 5_000 });
  expect(readRemoteConnection("env").status).toBe("connected");
  // Only requests started afterwards extend the run: the second and third make three.
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("connected");
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("unreachable");
});

it("keeps timeout runs per machine", () => {
  recordRemoteConnection("a");
  recordRemoteConnection("b");
  timeOutSequentially("a");
  timeOutSequentially("b");
  timeOutSequentially("a");
  timeOutSequentially("b");
  timeOutSequentially("a");
  expect(readRemoteConnection("a").status).toBe("unreachable");
  expect(readRemoteConnection("b").status).toBe("connected");
});

it("lets a single answer end a run of timeouts", () => {
  timeOutSequentially();
  timeOutSequentially();
  recordRemoteConnection("env");
  timeOutSequentially();
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("connected");
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("unreachable");
});

it("does not count busy or replaced requests as timeouts", () => {
  recordRemoteConnection("env");
  for (let i = 0; i < 6; i += 1)
    recordRemoteConnection("env", new Error("RPC_WS_OVERLOAD: Host is busy"));
  expect(readRemoteConnection("env").status).toBe("connected");
});

it("forgets a run of timeouts when the machine is reset or forgotten", () => {
  timeOutSequentially();
  timeOutSequentially();
  resetRemoteConnection("env");
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("connecting");
  timeOutSequentially();
  forgetRemoteConnection("env");
  timeOutSequentially();
  timeOutSequentially();
  expect(readRemoteConnection("env").status).toBe("connecting");
});
