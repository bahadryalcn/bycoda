import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LogSink, setDefaultLogSink } from "../diagnostics/logger";
import {
  HostDomainAuthorizationError,
  HostDomainOutcomeError,
  HostDomainRefusalError,
} from "../domains/context";
import { SessionReadError } from "../domains/sessions/read-errors";
import {
  dispatchOwnerRpc,
  HOST_STOP_GRACE_MS,
  HostStoppingError,
  isInternalFailure,
  OwnerRpcDeadlineError,
  ownerRpcDeadlineMs,
  rpcFailureFields,
  slowRpcThresholdMs,
} from "./owner-rpc";

it("answers 500 only for runtime and system faults, not for client-facing errors", () => {
  expect(isInternalFailure(new TypeError("Cannot read properties of undefined"))).toBe(true);
  expect(isInternalFailure(new RangeError("Invalid array length"))).toBe(true);
  expect(
    isInternalFailure(
      Object.assign(new Error("EACCES: permission denied, open 'C:\\secret\\x'"), {
        syscall: "open",
      }),
    ),
  ).toBe(true);
  expect(
    isInternalFailure(new HostDomainRefusalError("LEASE_HELD", "conflict", true, "Busy.")),
  ).toBe(false);
  expect(isInternalFailure(new HostDomainOutcomeError("Not saved", "not-sent"))).toBe(false);
  expect(isInternalFailure(new Error("Unsupported host method"))).toBe(false);
  expect(isInternalFailure("plain string")).toBe(false);
});

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  setDefaultLogSink(undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs `machine.changes` with a stubbed change reader and returns what the Host logged. */
async function changesCall(
  read: (advance: (ms: number) => void) => unknown,
  input: Record<string, unknown> = {},
  params: Record<string, unknown> = { waitMs: 10_000 },
): Promise<{ log: string; failure: unknown }> {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-owner-rpc-"));
  dirs.push(dir);
  const sink = new LogSink({ dir, mirror: false, minLevel: "debug" });
  setDefaultLogSink(sink);
  let clock = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const dependencies = {
    heldPolls: new Map(),
    engine: { store: { authenticated: async () => true } },
    remoteChanges: { read: async () => read((ms) => (clock += ms)) },
  };
  const request = {
    input: { method: "machine.changes", ...input },
    params,
    result: undefined,
    token: "token",
    pollState: { revoked: false },
    response: { once: () => undefined },
  };
  let failure: unknown;
  await dispatchOwnerRpc(dependencies as never, request as never).catch((error: unknown) => {
    failure = error;
  });
  sink.close();
  let log = "";
  try {
    log = readFileSync(sink.path, "utf8");
  } catch {
    // Nothing was logged.
  }
  return { log, failure };
}

it("does not report a held poll as slow for the wait its caller asked for", async () => {
  const idle = await changesCall((advance) => (advance(10_009), {}));
  expect(idle.failure).toBeUndefined();
  expect(idle.log).toBe("");
  const stuck = await changesCall((advance) => (advance(12_500), {}));
  expect(stuck.log).toContain("slow call method=machine.changes ms=12500");
  // A poll that asked for no wait is an ordinary read.
  const unheld = await changesCall((advance) => (advance(2_100), {}), {}, {});
  expect(unheld.log).toContain("slow call method=machine.changes ms=2100");
});

it("keeps the plain threshold for calls that do not hold", () => {
  expect(slowRpcThresholdMs("sessions.desktopLive", { waitMs: 30_000 })).toBe(2_000);
  expect(slowRpcThresholdMs("git.action", {})).toBe(2_000);
  expect(slowRpcThresholdMs("sessions.sync", { waitMs: 4_000 })).toBe(6_000);
  // The Host ends a poll at its own cap, so a longer requested wait earns no more.
  expect(slowRpcThresholdMs("sessions.sync", { waitMs: 30_000 })).toBe(12_000);
  expect(slowRpcThresholdMs("machine.changes", { waitMs: "soon" })).toBe(2_000);
  expect(slowRpcThresholdMs("workspace.run", {})).toBe(Infinity);
  expect(slowRpcThresholdMs("assistant.request", {})).toBe(Infinity);
});

/** Dispatches `machine.changes` whose reader never settles, under the given request signal. */
function stuckCall(signal: AbortSignal): { call: Promise<void> } {
  const dependencies = {
    heldPolls: new Map(),
    engine: { store: { authenticated: async () => true } },
    remoteChanges: { read: () => new Promise(() => undefined) },
  };
  const request = {
    input: { method: "machine.changes" },
    params: {},
    result: undefined,
    token: "token",
    pollState: { revoked: false },
    response: { once: () => undefined },
    domainContext: { signal, authorized: async () => true },
  };
  return { call: dispatchOwnerRpc(dependencies as never, request as never) };
}

it("answers a handler that never settles with a deadline error once the deadline passes", async () => {
  const abort = new AbortController();
  const { call } = stuckCall(abort.signal);
  abort.abort(new DOMException("Host RPC deadline", "TimeoutError"));
  const failure = await call.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(OwnerRpcDeadlineError);
  expect(failure).toBeInstanceOf(HostDomainOutcomeError);
  expect(failure).toMatchObject({
    code: "HOST_RPC_DEADLINE",
    delivery: "unknown",
    message: "Host did not answer machine.changes within 120 s.",
  });
});

it("stops waiting on a stuck handler when the client disconnects", async () => {
  const abort = new AbortController();
  const { call } = stuckCall(abort.signal);
  abort.abort();
  await expect(call).rejects.toThrow("Request cancelled");
  const already = stuckCall(abort.signal);
  await expect(already.call).rejects.toThrow("Request cancelled");
});

it("answers a stuck handler with HOST_STOPPING once the stop grace passes after shutdown", async () => {
  vi.useFakeTimers();
  try {
    const abort = new AbortController();
    const { call } = stuckCall(abort.signal);
    let failure: unknown;
    void call.catch((error: unknown) => {
      failure = error;
    });
    abort.abort(new HostStoppingError());
    await vi.advanceTimersByTimeAsync(HOST_STOP_GRACE_MS - 1);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toBeInstanceOf(HostStoppingError);
    expect(failure).toMatchObject({ code: "HOST_STOPPING", delivery: "unknown" });
    // A call that arrives after shutdown began gets the same grace, then the same answer.
    const late = stuckCall(abort.signal).call.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(HOST_STOP_GRACE_MS);
    expect(await late).toBeInstanceOf(HostStoppingError);
  } finally {
    vi.useRealTimers();
  }
});

it("gives long-running methods a deadline beyond their client's and owner commands none", () => {
  expect(ownerRpcDeadlineMs("sessions.get", {})).toBe(120_000);
  expect(ownerRpcDeadlineMs("machine.changes", { waitMs: 10_000 })).toBe(120_000);
  expect(ownerRpcDeadlineMs("git.action", {})).toBe(640_000);
  expect(ownerRpcDeadlineMs("git.switch", {})).toBe(480_000);
  expect(ownerRpcDeadlineMs("appearance.backgroundImage", {})).toBe(280_000);
  expect(ownerRpcDeadlineMs("devices.capture", {})).toBe(220_000);
  expect(ownerRpcDeadlineMs("browser.setup", {})).toBe(1_260_000);
  expect(ownerRpcDeadlineMs("workspace.run", {})).toBe(Infinity);
  expect(ownerRpcDeadlineMs("assistant.request", {})).toBe(Infinity);
  // A prototype key is not a method name.
  expect(ownerRpcDeadlineMs("constructor", {})).toBe(120_000);
});

it("logs a pre-execution refusal at debug with its code, not as a handler failure", async () => {
  const refusal = new HostDomainRefusalError("LEASE_HELD", "conflict", true, "Session is busy");
  const { log, failure } = await changesCall(() => {
    throw refusal;
  });
  expect(failure).toBe(refusal);
  expect(log).not.toContain("handler failed");
  expect(log).not.toContain("WARN");
  expect(log).toMatch(/DEBUG \[host\.rpc\] refused method=machine\.changes .*code=LEASE_HELD/);
  expect(log).toContain("category=conflict");
});

it("correlates an unexpected failure without logging its message or params", async () => {
  const secret = "prompt text with token sk-live-123";
  const first = await changesCall(
    () => {
      throw new Error(secret);
    },
    { id: "req-7" },
    { waitMs: 1, commandId: "cmd-9", prompt: secret },
  );
  expect(first.log).toContain("WARN  [host.rpc] handler failed method=machine.changes");
  expect(first.log).toContain("id=req-7");
  expect(first.log).toContain("commandId=cmd-9");
  expect(first.log).not.toContain("sk-live-123");
  expect(first.log).not.toContain("prompt text");
  const fingerprint = /fingerprint=([0-9a-f]{12})/.exec(first.log)?.[1];
  expect(fingerprint).toBeTruthy();
  const repeat = await changesCall(() => {
    throw new Error(secret);
  });
  expect(repeat.log).toContain(`fingerprint=${fingerprint}`);
  const other = await changesCall(() => {
    throw new Error("a different failure");
  });
  expect(other.log).not.toContain(`fingerprint=${fingerprint}`);
});

it("logs the message only for error classes with fixed or client-safe text", () => {
  const request = {
    input: { method: "sessions.get", id: "has spaces\nand a newline" },
    params: {},
  };
  expect(rpcFailureFields(new SessionReadError("overloaded"), request)).toMatchObject({
    error: "SessionReadError",
    kind: "overloaded",
    message: "Conversation reads are busy. Retrying shortly.",
    fingerprint: undefined,
    id: undefined,
  });
  expect(rpcFailureFields(new HostDomainAuthorizationError(), request)).toMatchObject({
    code: "HOST_DOMAIN_AUTHORIZATION",
    message: "Device authorization was revoked",
  });
  expect(
    rpcFailureFields(new HostDomainOutcomeError("Note was not saved", "not-sent"), request).message,
  ).toBe("Note was not saved");
  const errno = Object.assign(new Error("ENOENT: no such file, open 'C:\\Users\\me\\x'"), {
    code: "ENOENT",
  });
  expect(rpcFailureFields(errno, request)).toMatchObject({ code: "ENOENT", message: undefined });
  expect(rpcFailureFields("plain string", request)).toMatchObject({
    error: "UnknownError",
    message: undefined,
    fingerprint: undefined,
  });
});
