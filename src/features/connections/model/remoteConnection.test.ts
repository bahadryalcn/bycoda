import { describe, expect, it, vi } from "vitest";
import {
  autoRetryDelay,
  blocksSending,
  connectionIndicator,
  connectionOutcome,
  INITIAL_CONNECTION,
  reduceConnection,
  sanitizeConnectionError,
  sendAfterReconnect,
  BLOCKED_RETRY_LIMIT,
  shouldAutoRetry,
  shouldRetryBlocked,
  type RemoteConnectionState,
} from "./remoteConnection";

const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
const denied =
  "SSH connection failed: user@host: Permission denied (publickey). Open Settings → Connections and reconnect to check access.";
const timedOut = "SSH timed out connecting to the machine.";

describe("connectionOutcome", () => {
  it.each(["RPC_WS_BLOCKED", "RPC_WS_TLS", "RPC_WS_SCHEMA"])(
    "holds sending for %s until explicit recovery",
    (code) => {
      const error = Object.assign(new Error(`${code}: Host admission failed`), { code });
      const state = reduceConnection(
        { status: "connected", lastSeen: 10 },
        { type: "failure", error, at: 20 },
      );
      expect(state).toMatchObject({ status: "connection-blocked", lastSeen: 10 });
      expect(blocksSending(state.status)).toBe(true);
      expect(shouldAutoRetry(state.status, undefined, 30)).toBe(false);
      expect(reduceConnection(state, { type: "ok", at: 30 })).toBe(state);
      expect(reduceConnection(state, { type: "failure", error: down, at: 40 })).toBe(state);
      expect(reduceConnection(state, { type: "recovered", at: 50 })).toEqual({
        status: "connected",
        lastSeen: 50,
      });
    },
  );
  it("tells a silent machine from one that needs a sign-in", () => {
    expect(connectionOutcome(down).status).toBe("unreachable");
    expect(
      connectionOutcome(new Error("SSH connection failed: Connection timed out.")).status,
    ).toBe("unreachable");
    expect(connectionOutcome(denied).status).toBe("needs-auth");
    // Background attempts never prompt (BatchMode), so a timeout is the network.
    expect(connectionOutcome(timedOut).status).toBe("unreachable");
    expect(connectionOutcome("SSH connection failed: Host key verification failed.").status).toBe(
      "host-key",
    );
    expect(connectionOutcome("Host is not running on the machine. Start it.").status).toBe(
      "host-not-running",
    );
  });

  it("uses ssh's exit status and the port check the desktop sends along", () => {
    const tagged = (tag: string, stderr: string) =>
      `SSH connection failed (${tag}): ${stderr}. Open Settings`;
    expect(connectionOutcome(tagged("exit 255, host reachable", "")).status).toBe("needs-auth");
    expect(connectionOutcome(tagged("exit 255, host unreachable", "")).status).toBe("unreachable");
    expect(connectionOutcome(tagged("exit 255", "mystery")).status).toBe("unreachable");
    expect(
      connectionOutcome(tagged("exit 255, host unreachable", "Permission denied (publickey)."))
        .status,
    ).toBe("needs-auth");
  });

  it("reads an old host and a machine that answered with its own error", () => {
    expect(connectionOutcome("Host rejected request: Unsupported workspace command").status).toBe(
      "outdated-host",
    );
    expect(connectionOutcome("Host rejected request: Branch x does not exist")).toEqual({
      status: "connected",
    });
  });

  it("explains the reason briefly and never shows commands or secrets", () => {
    expect(connectionOutcome(down).error).toBe(
      "The machine did not answer. It may be off, asleep or offline.",
    );
    expect(connectionOutcome(denied).error).toMatch(/password or key/);
    const leaky = connectionOutcome(
      "SSH connection failed: ssh -T -o BatchMode=yes -i /home/me/key host. Bearer abc.def-123 token=hunter2",
    ).error!;
    expect(leaky).not.toMatch(/BatchMode|abc\.def|hunter2|ssh -T/);
  });
});

describe("sanitizeConnectionError", () => {
  it("drops the settings hint, collapses whitespace and bounds the length", () => {
    expect(
      sanitizeConnectionError(
        "No route\n to host. Open Settings → Connections and reconnect to check access.",
      ),
    ).toBe("No route to host.");
    expect(sanitizeConnectionError("x".repeat(500)).length).toBe(198);
  });
});

describe("reduceConnection", () => {
  const ok = (at: number) => ({ type: "ok", at }) as const;
  const fail = (error: unknown, at = 0) => ({ type: "failure", error, at }) as const;

  it("moves between connected, unreachable and needs-auth, keeping when it was last seen", () => {
    let state = reduceConnection(INITIAL_CONNECTION, ok(100));
    expect(state).toEqual({ status: "connected", lastSeen: 100 });
    state = reduceConnection(state, fail(down, 200));
    expect(state).toMatchObject({ status: "unreachable", lastSeen: 100 });
    state = reduceConnection(state, fail(denied, 300));
    expect(state).toMatchObject({ status: "needs-auth", lastSeen: 100 });
    state = reduceConnection(state, ok(400));
    expect(state).toEqual({ status: "connected", lastSeen: 400 });
  });

  it("returns the same object for a repeated failure", () => {
    const state = reduceConnection(INITIAL_CONNECTION, fail(down));
    expect(reduceConnection(state, fail(down, 5))).toBe(state);
  });

  it("shows a dropped tunnel at once, and one drop is one change", () => {
    let state = reduceConnection(INITIAL_CONNECTION, ok(100));
    const exit = {
      type: "tunnel-exit",
      exitCode: 255,
      stderr: "Timeout, server mini not responding.",
      at: 200,
    } as const;
    state = reduceConnection(state, exit);
    expect(state).toMatchObject({ status: "unreachable", lastSeen: 100 });
    expect(state.error).toMatch(/dropped.*not responding/);
    // The request that fails next only says "did not answer": nothing changes.
    expect(reduceConnection(state, fail(down, 250))).toBe(state);
    expect(reduceConnection(state, exit)).toBe(state);
    // A drop that needs the user says so.
    const signIn = reduceConnection(state, {
      ...exit,
      stderr: "user@mini: Permission denied (publickey).",
    });
    expect(signIn.status).toBe("needs-auth");
  });

  it("ignores a late tunnel exit once the machine waits for the user", () => {
    const waiting = reduceConnection(INITIAL_CONNECTION, fail(denied));
    expect(reduceConnection(waiting, { type: "tunnel-exit", stderr: "", at: 1 })).toBe(waiting);
  });

  it("leaves a connected machine's state alone when a request times out", () => {
    const state = { status: "connected", lastSeen: 100 } as const;
    const timeout =
      "The host request did not complete [RPC_TIMEOUT] (workspace.run). The host exceeded the request deadline.";
    expect(reduceConnection(state, fail(timeout, 200))).toBe(state);
    expect(reduceConnection(state, fail("Invalid host response", 200))).toBe(state);
  });

  it("keeps an unreachable machine unreachable when a request times out", () => {
    const state = reduceConnection(INITIAL_CONNECTION, fail(down, 200));
    expect(state.status).toBe("unreachable");
    expect(
      reduceConnection(
        state,
        fail("The host request did not complete [RPC_PROTOCOL] (git.index).", 300),
      ),
    ).toBe(state);
  });

  it("does not mark a machine connected for a timeout or a bad answer", () => {
    expect(connectionOutcome("Invalid host response").status).toBeUndefined();
    expect(
      connectionOutcome("The host request did not complete [RPC_TIMEOUT] (workspace.run). Retry.")
        .status,
    ).toBeUndefined();
    const connecting = reduceConnection(INITIAL_CONNECTION, fail("Invalid host response", 5));
    expect(connecting).toBe(INITIAL_CONNECTION);
  });

  it("blocks a machine that refused the request's access, and never calls it connected", () => {
    const text =
      "Host rejected request [RPC_AUTHORIZATION] (workspace.run). Reconnect the selected machine and check its access scope.";
    expect(connectionOutcome(text)).toEqual({
      status: "connection-blocked",
      error: text,
      specific: true,
    });
    const state = reduceConnection({ status: "connected", lastSeen: 10 }, fail(text, 20));
    expect(state).toMatchObject({ status: "connection-blocked", lastSeen: 10 });
    expect(reduceConnection(state, ok(30))).toBe(state);
  });

  it("counts a machine's own error as an answer", () => {
    const state = reduceConnection(INITIAL_CONNECTION, fail(down));
    expect(reduceConnection(state, fail("Host rejected request: nope", 9)).status).toBe(
      "connected",
    );
  });

  it("keeps an outdated host noticed until a reconnect or update", () => {
    let state = reduceConnection(INITIAL_CONNECTION, fail("Unsupported host method"));
    expect(state.status).toBe("outdated-host");
    state = reduceConnection(state, ok(1));
    expect(state.status).toBe("outdated-host");
    expect(reduceConnection(state, { type: "recovered", at: 2 })).toEqual({
      status: "connected",
      lastSeen: 2,
    });
  });
});

describe("automatic retry rule", () => {
  it("doubles the wait up to five minutes, jittered between half and all of it", () => {
    const most = () => 1;
    const least = () => 0;
    expect([0, 1, 2, 3, 4, 7, 8, 20].map((attempt) => autoRetryDelay(attempt, most))).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 256_000, 300_000, 300_000,
    ]);
    expect([0, 8].map((attempt) => autoRetryDelay(attempt, least))).toEqual([1_000, 150_000]);
  });

  it("only retries a silent machine, never one that needs a password", () => {
    expect(shouldAutoRetry("unreachable", undefined, 0)).toBe(true);
    expect(shouldAutoRetry("host-not-running", undefined, 0)).toBe(true);
    for (const status of [
      "needs-auth",
      "host-key",
      "connected",
      "connecting",
      "outdated-host",
    ] as const)
      expect(shouldAutoRetry(status, undefined, 0)).toBe(false);
  });

  it("never retries when automatic reconnecting is off", () => {
    expect(shouldAutoRetry("unreachable", undefined, 0, false)).toBe(false);
    expect(shouldAutoRetry("host-not-running", undefined, 0, false)).toBe(false);
    expect(shouldAutoRetry("unreachable", undefined, 0, true)).toBe(true);
  });

  it("stops after the window has been hidden for ten minutes", () => {
    expect(shouldAutoRetry("unreachable", 0, 10 * 60_000)).toBe(true);
    expect(shouldAutoRetry("unreachable", 0, 10 * 60_000 + 1)).toBe(false);
  });
});

describe("shouldRetryBlocked", () => {
  it("makes a few quiet attempts at a blocked machine, then waits for the user", () => {
    expect(BLOCKED_RETRY_LIMIT).toBe(3);
    expect([0, 1, 2, 3].map((attempts) => shouldRetryBlocked(attempts, undefined, 0))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("follows the automatic-reconnecting setting and the hidden window", () => {
    expect(shouldRetryBlocked(0, undefined, 0, false)).toBe(false);
    expect(shouldRetryBlocked(0, 0, 10 * 60_000)).toBe(true);
    expect(shouldRetryBlocked(0, 0, 10 * 60_000 + 1)).toBe(false);
  });
});

describe("sendAfterReconnect", () => {
  const base = () => ({
    reconnect: vi.fn(async () => ({ ok: true }) as const),
    send: vi.fn(() => true),
    wake: vi.fn(),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("sends at once when the machine is not known to be down", async () => {
    const fakes = base();
    expect(await sendAfterReconnect({ status: "connected", ...fakes })).toEqual({ sent: true });
    expect(fakes.reconnect).not.toHaveBeenCalled();
    expect(fakes.wake).not.toHaveBeenCalled();
  });

  it("saves and sends at once while the machine is down, without waiting for it", async () => {
    let finish!: (value: { ok: boolean }) => void;
    const fakes = {
      ...base(),
      reconnect: vi.fn(() => new Promise<never>((resolve) => (finish = resolve as never))),
    };
    expect(await sendAfterReconnect({ status: "unreachable", ...fakes })).toEqual({ sent: true });
    expect(fakes.send).toHaveBeenCalledTimes(1);
    expect(fakes.reconnect).toHaveBeenCalledTimes(1);
    expect(fakes.wake).not.toHaveBeenCalled();
    finish({ ok: true });
    await settle();
    expect(fakes.wake).toHaveBeenCalledTimes(1);
  });

  it("wakes the poll once a background reconnect answers, and not after a failure", async () => {
    const fakes = base();
    await sendAfterReconnect({ status: "connection-blocked", ...fakes });
    await settle();
    expect(fakes.wake).toHaveBeenCalledTimes(1);
    const failed = {
      ...base(),
      reconnect: vi.fn(async () => ({ ok: false, error: "no" }) as const),
    };
    await sendAfterReconnect({ status: "unreachable", ...failed });
    await settle();
    expect(failed.wake).not.toHaveBeenCalled();
  });

  it("holds a message only when a sign-in is needed and the reconnect fails, and says why", async () => {
    const fakes = base();
    fakes.reconnect.mockResolvedValue({ ok: false, error: "no answer" } as never);
    expect(await sendAfterReconnect({ status: "needs-auth", ...fakes })).toEqual({
      sent: false,
      failure: "reconnect",
      error: "no answer",
    });
    expect(fakes.send).not.toHaveBeenCalled();
  });

  it("waits for a sign-in before sending, then wakes the poll", async () => {
    const fakes = base();
    expect(await sendAfterReconnect({ status: "host-key", ...fakes })).toEqual({ sent: true });
    expect(fakes.reconnect.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.send.mock.invocationCallOrder[0],
    );
    expect(fakes.wake).toHaveBeenCalledTimes(1);
  });

  it("waits for the view to be ready before sending, without a time limit", async () => {
    let ready!: (value: boolean) => void;
    const fakes = {
      ...base(),
      ready: vi.fn(() => new Promise<boolean>((resolve) => (ready = resolve))),
    };
    const pending = sendAfterReconnect({ status: "connected", ...fakes });
    await settle();
    expect(fakes.send).not.toHaveBeenCalled();
    ready(true);
    expect(await pending).toEqual({ sent: true });
    expect(fakes.send).toHaveBeenCalledTimes(1);
  });

  it("reports a declined message as not sent", async () => {
    const declined = { ...base(), send: vi.fn(() => false) };
    expect(await sendAfterReconnect({ status: "connected", ...declined })).toEqual({ sent: false });
  });
});

describe("indicators", () => {
  const state = (status: RemoteConnectionState["status"], error?: string) => ({ status, error });

  it("marks connected green, connecting amber and a lost machine red", () => {
    expect(connectionIndicator(state("connected"), false).tone).toBe("connected");
    expect(connectionIndicator(state("connecting"), false).tone).toBe("connecting");
    expect(connectionIndicator(state("unreachable", "It is off."), false)).toEqual({
      tone: "down",
      label: "Not connected. It is off.",
    });
    expect(connectionIndicator(state("needs-auth"), true).tone).toBe("connecting");
    expect(connectionIndicator(state("outdated-host", "Needs update."), false).tone).toBe(
      "connected",
    );
  });

  it("blocks sending only when messages cannot get through", () => {
    expect(blocksSending("unreachable")).toBe(true);
    expect(blocksSending("needs-auth")).toBe(true);
    expect(blocksSending("host-key")).toBe(true);
    expect(blocksSending("host-not-running")).toBe(true);
    expect(blocksSending("outdated-host")).toBe(false);
    expect(blocksSending("connecting")).toBe(false);
  });
});
