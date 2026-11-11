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
import { dispatchOwnerRpc, rpcFailureFields, slowRpcThresholdMs } from "./owner-rpc";

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
