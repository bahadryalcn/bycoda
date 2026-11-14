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
} from "./remoteHealth";
import { remotePath } from "./remoteProjects";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  useRemoteLoadFailure,
  recordRemoteConnection,
  reportRemoteConnection,
} from "./remoteHealth";
import { blocksSending, connectionIndicator, shouldAutoRetry } from "./remoteConnection";
import { adoptRemoteMachineInventory, reportRemoteMachineStatus } from "./connections";
import type { RemoteMachine } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const project = remotePath("env", "/Users/me/repo");
const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetRemoteHealth();
});
afterEach(() => vi.useRealTimers());

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

it("forgets a removed machine's connection, failure and backoff", () => {
  reportRemoteLoad(project, "changes", down);
  expect(readRemoteConnection("env").status).toBe("unreachable");
  forgetRemoteConnection("env");
  expect(readRemoteConnection("env")).toEqual({ status: "connecting" });
  expect(remotePollDue(project)).toBe(true);
});
