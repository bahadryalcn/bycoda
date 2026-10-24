// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { resetSessionsStore, setSessions } from "../../sessions/model/sessionsStore";
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
  runLeaseMachine,
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
