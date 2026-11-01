// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadRemoteCapabilities } from "./connections";
import { newSession } from "../../sessions/model/session";
import { getShellSessions, resetSessionsStore, setSessions } from "../../sessions/model/sessionsStore";
import { LeaseHeldError } from "../../sync/model/runLease";
import {
  acquireRunLease,
  configureRunLeaseClient,
  heldRunLeases,
  isRunLeasePending,
  noteRunLeases,
  releaseAllRunLeases,
  releaseRunLease,
  RUN_LEASE_IDLE_RELEASE_MS,
  RUN_LEASE_ACQUIRE_TIMEOUT_MS,
  runLeaseMachine,
  probeRunLease,
} from "./runLeaseClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("./connections", () => ({
  loadRemoteCapabilities: vi.fn(async () => []),
  remoteRequest: vi.fn(),
}));

const lease = { holder: "desktop:me", epoch: 7, expiresAt: Date.now() + 20_000 };
const calls: { method: string; params: Record<string, unknown> }[] = [];
let answer: (params: Record<string, unknown>) => unknown = () => ({ lease });
const transport = (async (_machine: string, method: string, params: Record<string, unknown>) => {
  calls.push({ method, params });
  return answer(params);
}) as never;

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ lease });
  vi.mocked(invoke).mockResolvedValue([]);
  vi.mocked(loadRemoteCapabilities).mockResolvedValue([]);
  resetSessionsStore([]);
  configureRunLeaseClient({ transport, machineId: "local" });
});
afterEach(() => configureRunLeaseClient());

it("asks the home host for the lease as this window and reports the grant", async () => {
  const pending = acquireRunLease("chat");
  expect(isRunLeasePending("chat")).toBe(true);
  expect(await pending).toEqual({ kind: "granted", lease });
  expect(isRunLeasePending("chat")).toBe(false);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: "sessions.runLease",
    params: { sessionId: "chat", action: "acquire", clientId: expect.stringMatching(/^desktop:/) },
  });
});

it("reports LEASE_HELD as a wait, however the host's refusal reads after the wire", async () => {
  answer = () => {
    throw new Error(`Host rejected request: ${new LeaseHeldError("host").message}`);
  };
  expect(await acquireRunLease("chat")).toEqual({
    kind: "held",
    text: "This session is running in bycoda on that computer. Wait for it to finish.",
  });
});

it("never blocks local work: no host, an older host or a failed call start the turn as before", async () => {
  answer = () => {
    throw new Error("RPC_HOST_UNAVAILABLE");
  };
  expect(await acquireRunLease("chat")).toEqual({ kind: "unavailable" });
  answer = () => {
    throw new Error("Unsupported remote operation");
  };
  expect(await acquireRunLease("chat")).toEqual({ kind: "unavailable" });
  configureRunLeaseClient({ transport });
  expect(runLeaseMachine()).toBeUndefined();
  expect(await acquireRunLease("chat")).toEqual({ kind: "unavailable" });
  expect(calls).toHaveLength(2);
});

it("keeps explicit retirement refusals closed even across the error wire", async () => {
  answer = () => { throw new Error("Host rejected: HOST_WRITER_RETIREMENT_FAILED: old writer unknown"); };
  expect(await acquireRunLease("chat")).toMatchObject({
    kind: "failed", text: expect.stringContaining("old writer unknown"),
  });
});

it("does not start without ownership ACK from a retirement-capable Host", async () => {
  configureRunLeaseClient({ transport, machineId: "local", retirement: true });
  answer = () => { throw new Error("RPC_HOST_UNAVAILABLE"); };
  expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed" });
});

it("starts a conversation the retirement-capable Host does not know yet", async () => {
  configureRunLeaseClient({ transport, machineId: "local", retirement: true });
  answer = () => { throw new Error("Host rejected request: Session not found on this machine"); };
  expect(await acquireRunLease("chat")).toEqual({ kind: "unavailable" });
});

it("discovers retirement capability and retains it when a later connection probe fails", async () => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport });
    vi.mocked(invoke).mockResolvedValue([{ id: "local", environmentId: "env", localHost: true, endpoint: "http://127.0.0.1:1" }]);
    vi.mocked(loadRemoteCapabilities).mockResolvedValue(["sessions.runLease", "sessions.host-writer-retirement.v1"]);
    expect(await probeRunLease()).toBe("local");
    await vi.advanceTimersByTimeAsync(15_001);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("connection probe failed"));
    expect(await probeRunLease()).toBe("local");
    answer = () => { throw new Error("offline"); };
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed" });
  } finally { vi.useRealTimers(); }
});

it("holds a pending retirement and returns a late grant by its original epoch", async () => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport, machineId: "local", retirement: true });
    let finish!: (value: unknown) => void;
    answer = (params) => params.action === "acquire"
      ? new Promise((resolve) => { finish = resolve; }) : {};
    const pending = acquireRunLease("chat");
    await vi.advanceTimersByTimeAsync(RUN_LEASE_ACQUIRE_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ kind: "failed", text: expect.stringContaining("unconfirmed") });
    expect(isRunLeasePending("chat")).toBe(false);
    // A retry cannot reuse the abandoned request's same-holder lease before
    // its late grant is returned, otherwise that release could cancel the retry.
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed", text: expect.stringContaining("still pending") });
    expect(calls).toHaveLength(1);
    finish({ lease });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].params).toMatchObject({ sessionId: "chat", action: "release", epoch: 7 });
    expect(heldRunLeases()).toEqual([]);
  } finally { vi.useRealTimers(); }
});

it("retains unknown ownership if returning an abandoned late lease fails", async () => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport, machineId: "local", retirement: true });
    let finish!: (value: unknown) => void;
    answer = (params) => {
      if (params.action === "acquire") return new Promise((resolve) => { finish = resolve; });
      throw new Error("release acknowledgement lost");
    };
    const pending = acquireRunLease("chat");
    await vi.advanceTimersByTimeAsync(RUN_LEASE_ACQUIRE_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ kind: "failed" });
    finish({ lease });
    await vi.advanceTimersByTimeAsync(0);
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed", text: expect.stringContaining("unknown") });
    expect(calls).toHaveLength(2);
  } finally { vi.useRealTimers(); }
});

it.each([
  "HOST_WRITER_RETIREMENT_PENDING: original writer is still stopping",
  "HOST_WRITER_RETIREMENT_FAILED: original writer cleanup failed",
  "LEASE_HELD: another writer owns the session",
])("allows a fresh ownership check after a late definitive refusal: %s", async (refusal) => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport, machineId: "local", retirement: true });
    const session = { ...newSession("codex", "/repo"), id: "chat", busy: false, providerSessionId: "original-thread" };
    resetSessionsStore([session]);
    let reject!: (error: Error) => void;
    let retired = false;
    answer = () => new Promise((_, fail) => { reject = fail; });
    const first = acquireRunLease("chat");
    await vi.advanceTimersByTimeAsync(RUN_LEASE_ACQUIRE_TIMEOUT_MS + 1);
    expect(await first).toMatchObject({ kind: "failed" });
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed" });
    expect(calls).toHaveLength(1);

    reject(new Error(`Host rejected request: ${refusal}`));
    await vi.advanceTimersByTimeAsync(0);
    // No lease was granted: do not release anything or replay the unsent message.
    expect(calls).toHaveLength(1);
    answer = () => {
      if (!retired) throw new Error(`Host rejected request: ${refusal}`);
      return { lease: { ...lease, epoch: 8 } };
    };
    expect(await acquireRunLease("chat")).toMatchObject({ kind: refusal.startsWith("LEASE_HELD") ? "held" : "failed" });
    expect(calls).toHaveLength(2);
    retired = true;
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "granted", lease: { epoch: 8 } });
    expect(calls.map((call) => call.params.action)).toEqual(["acquire", "acquire", "acquire"]);
    expect(calls.every((call) => call.params.sessionId === "chat")).toBe(true);
    expect(calls.every((call) => call.params.clientId === calls[0].params.clientId)).toBe(true);
    expect(getShellSessions()[0]).toMatchObject({ providerSessionId: "original-thread", busy: false });
  } finally { vi.useRealTimers(); }
});

it("keeps a late transport failure guarded because it cannot exclude a grant", async () => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport, machineId: "local", retirement: true });
    let reject!: (error: Error) => void;
    answer = () => new Promise((_, fail) => { reject = fail; });
    const first = acquireRunLease("chat");
    await vi.advanceTimersByTimeAsync(RUN_LEASE_ACQUIRE_TIMEOUT_MS + 1);
    expect(await first).toMatchObject({ kind: "failed" });
    reject(new Error("RPC_HOST_UNAVAILABLE: response lost"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed", text: expect.stringContaining("unknown") });
    expect(calls).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it("waits for the abandoned grant's release ACK before allowing a newer epoch", async () => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport, machineId: "local", retirement: true });
    let grant!: (value: unknown) => void;
    let release!: (value: unknown) => void;
    answer = (params) => new Promise((resolve) => {
      if (params.action === "acquire") grant = resolve;
      else release = resolve;
    });
    const first = acquireRunLease("chat");
    await vi.advanceTimersByTimeAsync(RUN_LEASE_ACQUIRE_TIMEOUT_MS + 1);
    expect(await first).toMatchObject({ kind: "failed" });
    grant({ lease });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[1].params).toMatchObject({ action: "release", epoch: 7 });
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed" });
    expect(calls).toHaveLength(2);
    release({});
    await vi.advanceTimersByTimeAsync(0);
    answer = () => ({ lease: { ...lease, epoch: 8 } });
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "granted", lease: { epoch: 8 } });
    expect(calls.map((call) => call.params.action)).toEqual(["acquire", "release", "acquire"]);
  } finally { vi.useRealTimers(); }
});

it("does not mistake a late grant's release refusal for an acquisition refusal", async () => {
  vi.useFakeTimers();
  try {
    configureRunLeaseClient({ transport, machineId: "local", retirement: true });
    let finish!: (value: unknown) => void;
    answer = (params) => {
      if (params.action === "acquire") return new Promise((resolve) => { finish = resolve; });
      throw new Error("HOST_WRITER_RETIREMENT_FAILED: release not acknowledged");
    };
    const first = acquireRunLease("chat");
    await vi.advanceTimersByTimeAsync(RUN_LEASE_ACQUIRE_TIMEOUT_MS + 1);
    expect(await first).toMatchObject({ kind: "failed" });
    finish({ lease });
    await vi.advanceTimersByTimeAsync(0);
    expect(await acquireRunLease("chat")).toMatchObject({ kind: "failed", text: expect.stringContaining("unknown") });
    expect(calls.map((call) => call.params.action)).toEqual(["acquire", "release"]);
  } finally { vi.useRealTimers(); }
});

it("gives the lease back when the turn it was taken for ends", async () => {
  await acquireRunLease("chat");
  resetSessionsStore([{ ...newSession("claude", "/repo"), id: "chat" }]);
  // Not started yet: nothing to give back.
  setSessions((all) => all.map((session) => ({ ...session, title: "renamed" })));
  expect(calls.map((call) => call.params.action)).toEqual(["acquire"]);
  setSessions((all) => all.map((session) => ({ ...session, busy: true })));
  setSessions((all) => all.map((session) => ({ ...session, busy: false })));
  await vi.waitFor(() =>
    expect(calls.map((call) => call.params.action)).toEqual(["acquire", "release"]),
  );
  // The release carries the epoch it was granted with, so a lease that moved on is not taken back.
  expect(calls[1]!.params).toMatchObject({ sessionId: "chat", epoch: 7 });
  setSessions((all) => all.map((session) => ({ ...session, busy: true })));
  setSessions((all) => all.map((session) => ({ ...session, busy: false })));
  expect(calls).toHaveLength(2);
});

it("reports the leases of the turns it runs for the heartbeat, and learns which one it lost", async () => {
  await acquireRunLease("chat");
  await acquireRunLease("other");
  // Only a turn that is running here is reported; one that has not started yet is not.
  expect(heldRunLeases()).toEqual([]);
  resetSessionsStore([
    { ...newSession("claude", "/repo"), id: "chat", busy: true },
    { ...newSession("claude", "/repo"), id: "other" },
  ]);
  setSessions((all) => all.map((session) => ({ ...session })));
  expect(heldRunLeases()).toEqual([{ sessionId: "chat", epoch: 7 }]);
  // The host kept one with a newer epoch, and took the other back.
  const newer = { ...lease, epoch: 9 };
  expect(noteRunLeases({ chat: newer })).toEqual([]);
  expect(heldRunLeases()).toEqual([{ sessionId: "chat", epoch: 9 }]);
  expect(noteRunLeases({ chat: null, unknown: null })).toEqual(["chat"]);
  expect(heldRunLeases()).toEqual([]);
  // A lost lease is not given back later: it is not this window's any more.
  setSessions((all) => all.map((session) => ({ ...session, busy: false })));
  expect(calls.map((call) => call.params.action)).not.toContain("release");
});

it("gives it back at once when the turn never started, and ignores a host that cannot be asked", async () => {
  await acquireRunLease("chat");
  await releaseRunLease("chat");
  expect(calls.map((call) => call.params.action)).toEqual(["acquire", "release"]);
  // Nothing held any more: a second release asks nobody.
  await releaseRunLease("chat");
  expect(calls).toHaveLength(2);
  await acquireRunLease("chat");
  answer = () => {
    throw new Error("offline");
  };
  await expect(releaseRunLease("chat")).resolves.toBeUndefined();
});

it("does not stop a turn that already ended when the host reports its lease lost", async () => {
  await acquireRunLease("chat");
  resetSessionsStore([{ ...newSession("claude", "/repo"), id: "chat", busy: true }]);
  setSessions((all) => all.map((session) => ({ ...session })));
  // The turn ended in the meantime (and the lease with it); the answer comes late.
  setSessions((all) => all.map((session) => ({ ...session, busy: false })));
  await acquireRunLease("chat");
  expect(noteRunLeases({ chat: null })).toEqual([]);
  expect(heldRunLeases()).toEqual([]);
});

it("gives a lease back when its turn never became busy, and keeps it for one that did", async () => {
  vi.useFakeTimers();
  try {
    await acquireRunLease("failed");
    await acquireRunLease("running");
    resetSessionsStore([{ ...newSession("claude", "/repo"), id: "running", busy: true }]);
    setSessions((all) => all.map((session) => ({ ...session })));
    await vi.advanceTimersByTimeAsync(RUN_LEASE_IDLE_RELEASE_MS + 1);
    const released = calls.filter((call) => call.params.action === "release");
    expect(released.map((call) => call.params.sessionId)).toEqual(["failed"]);
  } finally {
    vi.useRealTimers();
  }
});

it("gives every lease back when the window closes", async () => {
  await acquireRunLease("one");
  await acquireRunLease("two");
  await releaseAllRunLeases();
  expect(
    calls.filter((call) => call.params.action === "release").map((call) => call.params.sessionId),
  ).toEqual(["one", "two"]);
});
