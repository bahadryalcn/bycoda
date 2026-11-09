// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { request, requestReconnect } = vi.hoisted(() => ({
  request: vi.fn(),
  requestReconnect: vi.fn(),
}));
const machine = {
  id: "m1",
  name: "Mini",
  endpoint: "",
  environmentId: "env",
  ssh: { target: "me@mini", remotePort: 3774 },
};
vi.mock("./connections", () => ({
  knownRemoteMachine: () => machine,
  recordRemoteCapabilities: vi.fn(),
  remoteMachineFor: async () => machine,
  remoteRequest: request,
  requestMachineReconnect: requestReconnect,
}));

import { saveRemoteAutoReconnect } from "../../settings/model/settings";
import {
  reconnectRemoteMachine,
  startRemoteAutoRecovery,
  isReconnecting,
  isReconnectRequested,
  cancelRemoteReconnect,
} from "./remoteReconnect";
import { invalidateConnection, readRemoteLifecycle } from "./remoteLifecycle";
import {
  applyRemoteConnection,
  forgetRemoteConnection,
  readRemoteConnection,
  recordRemoteConnection,
  resetRemoteHealth,
  subscribeRemoteRecovered,
} from "./remoteHealth";

const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
const denied = "SSH connection failed: Permission denied (publickey).";
let stop: () => void;
let online = true;

beforeEach(() => {
  localStorage.clear();
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  // The longest jittered wait, so the ladder reads 2, 4, 8, 16 seconds.
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetRemoteHealth();
  request.mockReset();
  requestReconnect.mockReset();
  stop = startRemoteAutoRecovery();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("automatic recovery", () => {
  it("does not retry a refused host identity on timers, focus or network recovery", async () => {
    recordRemoteConnection(
      "env",
      "Host identity changed. Add this machine again before continuing.",
    );
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(request).not.toHaveBeenCalled();
    expect(requestReconnect).not.toHaveBeenCalled();
    expect(readRemoteConnection("env").status).toBe("identity-mismatch");
  });
  it("retries a dropped machine after 2, 4 and 8 seconds, then reconnects it", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValue({ capabilities: [] });
    const recovered = vi.fn();
    const unsubscribe = subscribeRemoteRecovered(recovered);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(readRemoteConnection("env").status).toBe("connected");
    expect(recovered).toHaveBeenCalledTimes(1);
    // Coalesced recovery bypasses native cached failures without prompting.
    expect(request.mock.calls.every((call) => call[3] === true)).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(request).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("gives a blocked machine three quiet fresh attempts, then waits for Reconnect", async () => {
    const blocked = Object.assign(new Error("RPC_WS_BLOCKED: Host authentication was refused"), {
      code: "RPC_WS_BLOCKED",
    });
    request.mockRejectedValue(blocked);
    recordRemoteConnection("env", blocked);
    expect(readRemoteConnection("env").status).toBe("connection-blocked");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledTimes(3);
    // Focus and the network return do not add attempts beyond the quiet limit.
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every((call) => call[3] === true)).toBe(true);
    expect(readRemoteConnection("env").status).toBe("connection-blocked");
  });

  it("starts the blocked attempts afresh once the machine has answered", async () => {
    const blocked = Object.assign(new Error("RPC_WS_BLOCKED: Host authentication was refused"), {
      code: "RPC_WS_BLOCKED",
    });
    request.mockRejectedValue(blocked);
    recordRemoteConnection("env", blocked);
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000);
    expect(request).toHaveBeenCalledTimes(3);
    // The user's own Reconnect answers; a later block gets its quiet attempts again.
    request.mockResolvedValue({ capabilities: [] });
    await expect(reconnectRemoteMachine("env")).resolves.toEqual({ ok: true });
    expect(readRemoteConnection("env").status).toBe("connected");
    request.mockRejectedValue(blocked);
    recordRemoteConnection("env", blocked);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("stops retrying a machine once it is disconnected or removed", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(request).toHaveBeenCalledTimes(1);
    // What disconnecting or removing the machine does.
    invalidateConnection("env");
    forgetRemoteConnection("env");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(readRemoteConnection("env")).toEqual({ status: "connecting" });
  });

  it("does not retry, or prompt, when SSH needs a password", async () => {
    recordRemoteConnection("env", denied);
    expect(readRemoteConnection("env").status).toBe("needs-auth");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(request).not.toHaveBeenCalled();
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  it("retries at once when the window gains focus or the network returns", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("re-checks a machine waiting for sign-in on focus, without prompting", async () => {
    recordRemoteConnection("env", denied);
    request.mockResolvedValue({});
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(readRemoteConnection("env").status).toBe("connected");
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  it("does not dial a down machine again for focus events within 15 seconds", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("re-checks a machine waiting for sign-in on focus at most once in five minutes", async () => {
    recordRemoteConnection("env", denied);
    request.mockRejectedValue(denied);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  it("keeps backing off a host that drops again at once, and starts over after a stable connection", async () => {
    request.mockRejectedValueOnce(down).mockResolvedValue({ capabilities: [] });
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(2_000 + 4_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(readRemoteConnection("env").status).toBe("connected");
    // Dropped within 30 seconds: the next wait is the third rung, not the first.
    await vi.advanceTimersByTimeAsync(10_000);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(3);
    // Up for 30 seconds: the next drop retries after the shortest wait again.
    await vi.advanceTimersByTimeAsync(30_000);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("dials nothing while offline, and starts over at once when the network returns", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000);
    expect(request).toHaveBeenCalledTimes(3);
    online = false;
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(request).toHaveBeenCalledTimes(3);
    online = true;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(4);
    // The ladder restarted: the next wait is about four seconds, not sixteen.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(request).toHaveBeenCalledTimes(5);
  });
});

describe("with automatic reconnecting turned off", () => {
  it("makes no timer, focus, network or visibility retries", async () => {
    saveRemoteAutoReconnect(false);
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    expect(readRemoteConnection("env").status).toBe("unreachable");
  });

  it("still reconnects when the user asks", async () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", down);
    request.mockResolvedValue({});
    expect(await reconnectRemoteMachine("env")).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("m1", "environment.describe", {}, true);
    expect(readRemoteConnection("env").status).toBe("connected");
  });

  it("cancels waiting retries when switched off, and resumes at once when switched on", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(1_000);
    saveRemoteAutoReconnect(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
    // Turning it back on tries the machine that is down now, not after a wait.
    saveRemoteAutoReconnect(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    // ...and the schedule continues from there.
    await vi.advanceTimersByTimeAsync(3_999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("re-checks a machine waiting for sign-in once when switched on, without prompting", async () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", denied);
    request.mockRejectedValue(denied);
    saveRemoteAutoReconnect(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(requestReconnect).not.toHaveBeenCalled();
  });
});

describe("a dropped tunnel", () => {
  it("starts the retry schedule once, without waiting for a request to fail", async () => {
    request.mockRejectedValue(down);
    recordRemoteConnection("env");
    applyRemoteConnection("env", {
      type: "tunnel-exit",
      exitCode: 255,
      stderr: "Timeout, server mini not responding.",
      at: 0,
    });
    expect(readRemoteConnection("env").status).toBe("unreachable");
    // A request failing just after the drop adds neither a state change nor a second timer.
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("reconnectRemoteMachine", () => {
  it("marks only the attempts the user asked for, so background retries stay quiet", async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    recordRemoteConnection("env", down);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(isReconnecting("env")).toBe(true);
    expect(isReconnectRequested("env")).toBe(false);
    // Asking while a background attempt runs joins it and shows progress.
    const pending = reconnectRemoteMachine("env");
    expect(isReconnectRequested("env")).toBe(true);
    finish({});
    expect(await pending).toEqual({ ok: true });
    expect(isReconnecting("env")).toBe(false);
    expect(isReconnectRequested("env")).toBe(false);
  });

  it("ignores a late recovery after the route changes, without ending the replacement attempt", async () => {
    const finishes: ((value: unknown) => void)[] = [];
    request.mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
    const old = reconnectRemoteMachine("env");
    await vi.advanceTimersByTimeAsync(0);
    invalidateConnection("env");
    const replacement = reconnectRemoteMachine("env");
    await vi.advanceTimersByTimeAsync(0);
    finishes[0]({});
    expect((await old).ok).toBe(false);
    expect(isReconnecting("env")).toBe(true);
    expect(readRemoteConnection("env").status).not.toBe("connected");
    finishes[1]({});
    expect(await replacement).toEqual({ ok: true });
    expect(isReconnecting("env")).toBe(false);
  });

  it("cancels quiet recovery without accepting its late success or restarting retries", async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    recordRemoteConnection("env", down);
    const pending = reconnectRemoteMachine("env");
    await vi.advanceTimersByTimeAsync(0);
    cancelRemoteReconnect("env");
    finish({});
    expect((await pending).ok).toBe(false);
    expect(isReconnecting("env")).toBe(false);
    expect(readRemoteLifecycle("env").phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(readRemoteConnection("env").status).toBe("unreachable");
    request.mockResolvedValue({});
    expect(await reconnectRemoteMachine("env")).toEqual({ ok: true });
  });
  it("asks for a fresh tunnel and reports success", async () => {
    recordRemoteConnection("env", down);
    request.mockResolvedValue({});
    expect(await reconnectRemoteMachine("env")).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("m1", "environment.describe", {}, true);
    expect(readRemoteConnection("env").status).toBe("connected");
  });

  it("reports why it failed and hands over to Connections only for a sign-in", async () => {
    request.mockRejectedValue(down);
    const failed = await reconnectRemoteMachine("env", { signIn: true });
    expect(failed.ok).toBe(false);
    expect(requestReconnect).not.toHaveBeenCalled();
    request.mockRejectedValue(denied);
    await reconnectRemoteMachine("env", { signIn: false });
    expect(requestReconnect).not.toHaveBeenCalled();
    await reconnectRemoteMachine("env", { signIn: true });
    expect(requestReconnect).toHaveBeenCalledWith("m1");
  });

  it("shares one request between simultaneous attempts", async () => {
    request.mockResolvedValue({});
    await Promise.all([reconnectRemoteMachine("env"), reconnectRemoteMachine("env")]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
