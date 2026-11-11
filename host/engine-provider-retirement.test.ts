import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createChildProcessHandle,
  type ChildProcessHandle,
} from "../src/integrations/harness/core/child";
import { createProviderRetirementLedger } from "../src/integrations/harness/core/providerRetirement";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import { HostEngine, type ManagedTurnHistoryAdapter } from "./engine";
import type { HostProvider } from "./providers/providers";
import { handleSessionsRpc } from "./server/rpc-sessions";
import { HostStore } from "./store";
import { SessionRevisionConflictError } from "./storage/session-revision";

// Settlement recovery keeps its real exponential schedule; a test may run it faster.
const { recoveryDelays, clock } = vi.hoisted(() => ({
  recoveryDelays: [] as number[],
  clock: { speed: 1 },
}));
vi.mock("./storage/session-revision", async (original) => {
  const actual = await original<typeof import("./storage/session-revision")>();
  return {
    ...actual,
    persistenceRetryDelay: (failures: number, base?: number) => {
      const delay = actual.persistenceRetryDelay(failures, base);
      // The store passes its checkpoint interval; settlement recovery uses the default.
      if (base === undefined) recoveryDelays.push(delay);
      return delay / clock.speed;
    },
  };
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Deferred<T = void> = ReturnType<typeof deferred<T>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  recoveryDelays.length = 0;
  clock.speed = 1;
});

async function fixture(options: { warm?: boolean; title?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-engine-retirement-"));
  const store = new HostStore(join(directory, "host.db"));
  const kills = new Map<ChildProcessHandle, Deferred>();
  const kill = vi.fn(
    (handle: ChildProcessHandle) => kills.get(handle)?.promise ?? Promise.resolve(),
  );
  const ledger = createProviderRetirementLedger(`engine-retirement-${randomUUID()}`, kill);
  const starts: Array<{
    input: SendTurnInput;
    handle: ChildProcessHandle;
    finished: Deferred;
  }> = [];
  const releases: Array<ReturnType<typeof vi.fn<() => Promise<void>>>> = [];
  const releaseOnCleanup: Array<() => void> = [];
  const title = deferred<{ title: string; workItem: null } | null>();
  let enabled = true;
  const provider: HostProvider = {
    send: vi.fn(async (input) => {
      const handle = ledger.admit(createChildProcessHandle(input.sessionId));
      const finished = deferred();
      starts.push({ input, handle, finished });
      await finished.promise;
    }),
    stop: vi.fn(async () => {
      for (const start of starts) start.finished.resolve();
    }),
    cancel: vi.fn(async () => {
      for (const start of starts) start.finished.resolve();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
    ...(options.title ? { generateTitle: vi.fn(() => title.promise) } : {}),
  };
  const adapter: ManagedTurnHistoryAdapter = {
    exactGitRewindEnabled: () => enabled,
    workspaceForSession: async () => null,
    assertWritable: async () => {},
    history: {
      begin: async () => {
        throw new Error("No managed Git owner in this fixture");
      },
      end: async () => {
        throw new Error("No managed Git owner in this fixture");
      },
      get: async () => null,
      list: async () => [],
    },
    startActivity: vi.fn(async () => {
      const release = vi.fn(async () => {});
      releases.push(release);
      if (options.warm) enabled = false;
      return release;
    }),
  };
  const engine = new HostEngine(store, { codex: provider }, undefined, adapter);
  // Only filesystem history is controlled; Host SQL, accepted dispatch and family ledger are real.
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue(undefined);
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue(undefined);
  vi.spyOn(engine.checkpoints, "beginFilesTurn").mockResolvedValue(undefined);
  vi.spyOn(engine.checkpoints, "finishFilesTurn").mockResolvedValue(undefined);
  await engine.ready;
  const project = await store.addProject(directory, "Activity fixture");
  const created = await engine.command({
    type: "create",
    commandId: "create",
    workspaceMode: "current",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  cleanups.push(async () => {
    for (const release of releaseOnCleanup) release();
    for (const pending of kills.values()) pending.resolve();
    for (const start of starts) start.finished.resolve();
    title.resolve(null);
    await engine.close().catch(() => {}); // A test may intentionally retain a known failure.
    await store.close();
    const path = resolve(directory);
    if (
      dirname(path) !== resolve(tmpdir()) ||
      !basename(path).startsWith("bycoda-engine-retirement-")
    )
      throw new Error("Unexpected fixture path");
    rmSync(path, { recursive: true, force: true });
  });
  const send = async () => {
    const receipt = await engine.command({
      type: "send",
      commandId: randomUUID(),
      sessionId: created.sessionId,
      text: "Retain original work",
    });
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    return receipt;
  };
  return {
    directory,
    store,
    engine,
    provider,
    adapter,
    ledger,
    kill,
    kills,
    starts,
    releases,
    title,
    releaseOnCleanup,
    id: created.sessionId,
    send,
  };
}

it("keeps the actual Host activity and running SQL row until both original cleanup outcomes finish", async () => {
  const f = await fixture();
  const receipt = await f.send();
  const physical = deferred();
  f.kills.set(f.starts[0].handle, physical);
  const stop = deferred();
  f.releaseOnCleanup.push(() => stop.resolve());
  vi.mocked(f.provider.stop).mockImplementation(() => stop.promise);
  f.starts[0].finished.resolve();
  await vi.waitFor(() => expect(f.kill).toHaveBeenCalledWith(f.starts[0].handle));
  expect(f.releases[0]).not.toHaveBeenCalled();
  expect((await f.store.session(f.id)).status).toBe("running");
  physical.resolve();
  await Promise.resolve();
  expect(f.releases[0]).not.toHaveBeenCalled();
  stop.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(f.releases[0]).toHaveBeenCalledOnce();
  expect((await f.store.session(f.id)).status).toBe("idle");
});

it("settles the session despite a failed original stop/lease, still reports it on close and never retries a replacement", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const receipt = await f.send();
  const stopA = vi.mocked(f.provider.stop).mockRejectedValue(new Error("original stop unknown"));
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(f.releases[0]).not.toHaveBeenCalled();
  expect((await f.store.session(f.id)).status).toBe("idle");
  const stopB = vi.fn(async () => {});
  f.provider.stop = stopB;
  await expect(f.engine.close()).rejects.toThrow("Host session shutdown failed");
  // The failed original stop is never repeated; shutdown stops the still-retained provider once
  // through its current stop method (a best-effort, idempotent release, not a replacement turn).
  expect(stopA).toHaveBeenCalledOnce();
  expect(stopB).toHaveBeenCalledOnce();
  expect(f.kill).toHaveBeenCalledOnce();
});

it("retries only actual persistence bookkeeping and reuses the already completed original stop", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const saved = f.store.save.bind(f.store);
  let failed = false;
  vi.spyOn(f.store, "save").mockImplementation(async (value, event, options) => {
    if (!failed && (event as { type?: string }).type === "settled") {
      failed = true;
      throw new Error("first actual save failed");
    }
    return saved(value, event, options);
  });
  const settled = vi.fn(async () => {});
  f.engine.onSettled = settled;
  const receipt = await f.send();
  const originalStop = vi.mocked(f.provider.stop);
  f.starts[0].finished.resolve();
  await expect(f.engine.waitForRun(f.id, receipt.runId)).rejects.toThrow(
    "cleanup is still pending",
  );
  const replacementStop = vi.fn(async () => {});
  f.provider.stop = replacementStop;
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce(), { timeout: 5_000 });
  await vi.waitFor(async () => expect((await f.store.session(f.id)).status).toBe("interrupted"));
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(originalStop).toHaveBeenCalledOnce();
  expect(replacementStop).not.toHaveBeenCalled();
  expect(f.releases[0]).toHaveBeenCalledOnce();
});

it("keeps a real lease warm after a setting change and releases only its original passive cohort", async () => {
  const f = await fixture({ warm: true });
  const receipt = await f.send();
  const first = f.starts[0].handle;
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  expect((await f.store.session(f.id)).status).toBe("idle");
  expect(f.releases[0]).not.toHaveBeenCalled();
  expect(f.provider.stop).not.toHaveBeenCalled();
  const second = f.ledger.admit(createChildProcessHandle(f.id));
  await f.ledger.retire([first]);
  await vi.waitFor(() => expect(f.releases[0]).toHaveBeenCalledOnce());
  expect(f.kill.mock.calls.map(([handle]) => handle)).toEqual([first]);
  await f.ledger.retire([second]);
});

it("does not turn an onSettled failure into persistence recovery or release a new provider", async () => {
  const f = await fixture({ warm: true });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const callbackError = new Error("original delivery callback failed");
  f.engine.onSettled = async () => {
    throw callbackError;
  };
  const receipt = await f.send();
  f.starts[0].finished.resolve();
  await expect(f.engine.waitForRun(f.id, receipt.runId)).rejects.toBe(callbackError);
  expect(f.provider.stop).not.toHaveBeenCalled();
  expect(
    log.mock.calls.some(([message]) => String(message).includes("Session callback failed")),
  ).toBe(true);
  await expect(f.engine.close()).rejects.toThrow("Host session shutdown failed");
});

it("close drains original background title bookkeeping as well as its provider activity", async () => {
  const f = await fixture({ title: true });
  await f.send();
  await vi.waitFor(() => expect(f.provider.generateTitle).toHaveBeenCalledOnce());
  let closed = false;
  const closing = f.engine.close().then(() => {
    closed = true;
  });
  await vi.waitFor(() => expect(f.provider.stop).toHaveBeenCalledOnce());
  expect(closed).toBe(false);
  f.title.resolve({ title: "Original late title", workItem: null });
  await closing;
  expect(closed).toBe(true);
  expect(f.releases).toHaveLength(2);
  for (const release of f.releases) expect(release).toHaveBeenCalledOnce();
});

it("preserves a release callback failure and its exact public cleanup error during shutdown", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const receipt = await f.send();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = new Error("original activity release failed");
  f.releases[0].mockRejectedValue(error);
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  expect((await f.store.session(f.id)).status).toBe("idle");
  await expect(f.engine.close()).rejects.toThrow("Host session shutdown failed");
  expect(f.releases[0]).toHaveBeenCalledOnce();
});

it("close waits a pre-effect activity acquisition and prevents its late provider start", async () => {
  const f = await fixture();
  const entered = deferred();
  const admitted = deferred();
  const release = vi.fn(async () => {});
  f.releaseOnCleanup.push(() => admitted.resolve());
  vi.mocked(f.adapter.startActivity!).mockImplementation(async () => {
    entered.resolve();
    await admitted.promise;
    return release;
  });
  await f.engine.command({
    type: "send",
    commandId: "pending-admission",
    sessionId: f.id,
    text: "Admit original work",
  });
  await entered.promise;
  const closing = f.engine.close();
  admitted.resolve();
  await closing;
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect((await f.store.session(f.id)).status).toBe("interrupted");
});

it("does not hide an original background provider error behind a successful close", async () => {
  const f = await fixture({ title: true });
  vi.spyOn(console, "debug").mockImplementation(() => {});
  const receipt = await f.send();
  await vi.waitFor(() => expect(f.provider.generateTitle).toHaveBeenCalledOnce());
  f.title.reject(new Error("original title worker failed"));
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  await expect(f.engine.close()).rejects.toThrow("Host session shutdown failed");
});

it("retains the accepted cancel callback until real settlement and uses only original fallback cleanup", async () => {
  const f = await fixture();
  const receipt = await f.send();
  const cancellation = deferred();
  f.releaseOnCleanup.push(() => cancellation.resolve());
  vi.mocked(f.provider.cancel).mockImplementation(() => cancellation.promise);
  await f.engine.command({
    type: "cancel",
    commandId: "cancel-original",
    sessionId: f.id,
    runId: receipt.runId,
  });
  f.starts[0].finished.resolve();
  await vi.waitFor(() => expect(f.provider.stop).toHaveBeenCalledOnce());
  expect(f.releases[0]).not.toHaveBeenCalled();
  const stopB = vi.fn(async () => {});
  const stopA = f.provider.stop;
  f.provider.stop = stopB;
  cancellation.reject(new Error("Original cancel callback rejected"));
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(stopA).toHaveBeenCalledOnce();
  expect(stopB).not.toHaveBeenCalled();
  expect(f.releases[0]).toHaveBeenCalledOnce();
});

it("restores the original approval event after one real persistence failure and completes exact settlement", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const receipt = await f.send();
  const save = f.store.save.bind(f.store);
  const failure = new Error("approval event write failed");
  let failed = false;
  vi.spyOn(f.store, "save").mockImplementation(async (value, event, options) => {
    if (!failed && (event as { type?: string }).type === "events") {
      failed = true;
      throw failure;
    }
    return save(value, event, options);
  });
  const settled = deferred();
  f.engine.onSettled = () => settled.resolve();
  const occurrenceId = randomUUID();
  f.starts[0].input.onEvent({
    type: "approval.requested",
    requestId: 71,
    occurrenceId,
    title: "Original approval",
  });
  await settled.promise;
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(failed).toBe(true);
  const restored = await f.store.session(f.id);
  expect(restored.status).toBe("interrupted");
  expect(
    restored.session.blocks.find((block) => block.approval?.requestId === 71)?.approval
      ?.occurrenceId,
  ).toBe(occurrenceId);
  expect(f.provider.stop).toHaveBeenCalledOnce();
  expect(f.releases[0]).toHaveBeenCalledOnce();
  await f.engine.close();
});

/** Any Host writer that appends a session revision while a turn streams (assistant attribution). */
const stamp = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const head = await f.store.session(f.id);
  return f.store.save({ ...head, revision: head.revision + 1 }, { type: "fixture.stamp" });
};

it("keeps a running turn writable when a store-owned session write is ordered through the engine", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const receipt = await f.send();
  const stamped = await f.engine.sessionStoreWrite(f.id, () => stamp(f));
  f.starts[0].input.onEvent({ type: "message.delta", text: "The plan follows." });
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  const settled = await f.store.session(f.id);
  expect(settled.revision).toBeGreaterThan(stamped.revision);
  expect(settled.status).toBe("idle");
  expect(JSON.stringify(settled.session.blocks)).toContain("The plan follows.");
  expect(errors).not.toHaveBeenCalled();
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Revisions the store refused; an ordered writer never causes one. */
const refusedRevisions = (f: Fixture) => {
  const seen: SessionRevisionConflictError[] = [];
  const save = f.store.save.bind(f.store);
  vi.spyOn(f.store, "save").mockImplementation(async (value, event, options) => {
    try {
      return await save(value, event, options);
    } catch (error) {
      if (error instanceof SessionRevisionConflictError) seen.push(error);
      throw error;
    }
  });
  return seen;
};

/** Fails every save of the listed event types while `failing()` holds. */
const failSaves = (f: Fixture, types: string[], message: string, failing: () => boolean) => {
  const save = f.store.save.bind(f.store);
  return vi.spyOn(f.store, "save").mockImplementation(async (value, event, options) => {
    if (types.includes(String((event as { type?: string }).type)) && failing())
      throw new Error(message);
    return save(value, event, options);
  });
};

const preservedBatches = (f: Fixture) => {
  const directory = join(f.directory, "session-recovery", f.id);
  return readdirSync(directory).map((file) =>
    JSON.parse(readFileSync(join(directory, file), "utf8")),
  );
};

const transcript = async (f: Fixture) => JSON.stringify((await f.store.session(f.id)).session);

it("rebases a stale streamed delta and the next hard event onto the persisted head", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const refused = refusedRevisions(f);
  const receipt = await f.send();
  // A direct store write leaves the live turn one revision behind the persisted head.
  const head = await f.store.session(f.id);
  await f.store.save(
    { ...head, revision: head.revision + 1, pinned: true },
    { type: "fixture.unordered" },
  );
  f.starts[0].input.onEvent({ type: "message.delta", text: "Streamed on a stale revision." });
  await vi.waitFor(async () =>
    expect(await transcript(f)).toContain("Streamed on a stale revision."),
  );
  f.starts[0].input.onEvent({ type: "tool.started", callId: "call-1", title: "Read notes" });
  await vi.waitFor(async () => expect(await transcript(f)).toContain("Read notes"));
  expect((await f.store.session(f.id)).status).toBe("running");
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  const settled = await f.store.session(f.id);
  expect(settled.status).toBe("idle");
  // Both writers survive: the unordered change and the whole streamed turn.
  expect(settled.pinned).toBe(true);
  expect(await transcript(f)).toContain("Streamed on a stale revision.");
  // The stale delta was refused once and never reached the buffered rows.
  expect(refused).toHaveLength(1);
  const revisions = (
    await f.store.db
      .prepare("SELECT revision FROM events WHERE session_id=? ORDER BY revision")
      .all(f.id)
  ).map((row) => Number(row.revision));
  expect(revisions).toEqual(revisions.map((_, index) => revisions[0] + index));
  expect(revisions.at(-1)).toBe(settled.revision);
  expect(errors).not.toHaveBeenCalled();
});

it("preserves a batch that cannot be rebased as readable evidence and interrupts the turn on the persisted head", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const refused = refusedRevisions(f);
  const receipt = await f.send();
  const settled = deferred<{ interrupted?: boolean; reason?: string }>();
  f.engine.onSettled = (_id, outcome) => settled.resolve(outcome);
  // This writer changed the transcript itself: replaying events on it is not provable.
  const head = await f.store.session(f.id);
  await f.store.save(
    {
      ...head,
      revision: head.revision + 1,
      session: { ...head.session, title: "Changed elsewhere" },
    },
    { type: "fixture.unordered" },
  );
  const occurrenceId = randomUUID();
  const event = {
    type: "approval.requested" as const,
    requestId: 7,
    occurrenceId,
    title: "Private approval text",
  };
  f.starts[0].input.onEvent(event);
  expect(await settled.promise).toMatchObject({ interrupted: true });
  await f.engine.waitForRun(f.id, receipt.runId).catch(() => {});
  const persisted = await f.store.session(f.id);
  expect(persisted.status).toBe("interrupted");
  expect(persisted.session.title).toBe("Changed elsewhere");
  expect(f.engine.hasActiveRun(f.id)).toBe(false);
  expect(f.provider.stop).toHaveBeenCalled();
  // Refused once, preserved once, never retried.
  expect(refused).toHaveLength(1);
  const batches = preservedBatches(f);
  expect(batches).toHaveLength(1);
  expect(batches[0]).toMatchObject({
    kind: "bycoda.session.unwritten-batch",
    reason: "revision-conflict",
    sessionId: f.id,
    runId: receipt.runId,
    liveRevision: head.revision,
    headRevision: head.revision + 1,
    events: [event],
  });
  expect(
    batches[0].blocks.some(
      (block: { approval?: { requestId: number } }) => block.approval?.requestId === 7,
    ),
  ).toBe(true);
  const lines = errors.mock.calls.map(([line]) => String(line));
  expect(lines.filter((line) => line.includes("Preserved at"))).toHaveLength(1);
  expect(lines.join(" ")).toContain(f.id);
  expect(lines.join(" ")).not.toContain("Private approval text");
});

it("orders a pin with the running turn and keeps its expected-version result", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const refused = refusedRevisions(f);
  const receipt = await f.send();
  const { projectId } = await f.store.session(f.id);
  const pin = async (operationId: string, expectedVersion: number) => {
    const request = {
      input: { method: "sessions.pin.apply" },
      params: { sessionId: f.id, projectId, operationId, desiredPinned: true, expectedVersion },
      result: undefined as unknown,
    };
    await handleSessionsRpc({ engine: f.engine, adopt: async () => {} } as never, request as never);
    return request.result;
  };
  // Streamed output not yet written is ordered before the pin, which then sees a newer version.
  const stale = (await f.store.pinState(f.id, projectId)).version;
  f.starts[0].input.onEvent({ type: "message.delta", text: "Streamed before the pin." });
  expect(await pin("pin-stale", stale)).toMatchObject({ state: "superseded", pinned: false });
  const current = (await f.store.pinState(f.id, projectId)).version;
  expect(current).toBeGreaterThan(stale);
  expect(await pin("pin-current", current)).toEqual({
    state: "applied",
    version: current + 1,
    pinned: true,
  });
  f.starts[0].input.onEvent({ type: "message.delta", text: " Streamed after the pin." });
  f.starts[0].input.onEvent({ type: "tool.started", callId: "call-1", title: "Read notes" });
  f.starts[0].finished.resolve();
  await f.engine.waitForRun(f.id, receipt.runId);
  const settled = await f.store.session(f.id);
  expect(settled).toMatchObject({ status: "idle", pinned: true });
  expect(await transcript(f)).toContain("Streamed before the pin. Streamed after the pin.");
  expect(await transcript(f)).toContain("Read notes");
  expect(refused).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
});

it("backs settlement recovery off while storage keeps failing and reports it once", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  clock.speed = 200;
  let remaining = 4;
  failSaves(f, ["settled", "interrupted"], "transient fixture", () => remaining-- > 0);
  const settled = vi.fn(async () => {});
  f.engine.onSettled = settled;
  const receipt = await f.send();
  f.starts[0].finished.resolve();
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce(), { timeout: 5_000 });
  await vi.waitFor(async () => expect((await f.store.session(f.id)).status).toBe("interrupted"));
  await f.engine.waitForRun(f.id, receipt.runId);
  // One failed settlement, then three failed recoveries before the fourth succeeds.
  expect(recoveryDelays).toEqual([1_000, 2_000, 4_000, 8_000]);
  expect(
    errors.mock.calls.filter(([line]) => String(line).includes("recovery failed")),
  ).toHaveLength(1);
});

it("stops settlement recovery on a refused constraint and preserves the held batch", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  clock.speed = 200;
  const saves = failSaves(
    f,
    ["events", "settled", "interrupted"],
    "UNIQUE constraint failed: events.session_id, events.revision",
    () => true,
  );
  await f.send();
  f.starts[0].input.onEvent({ type: "approval.requested", requestId: 9, title: "Held approval" });
  const notRetried = () =>
    errors.mock.calls.filter(([line]) => String(line).includes("is not retried"));
  await vi.waitFor(() => expect(notRetried()).toHaveLength(1), { timeout: 5_000 });
  await vi.waitFor(() => expect(preservedBatches(f)).toHaveLength(1));
  const attempts = saves.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 400));
  // The first recovery was the last one: no timer, no further write, no further log line.
  expect(saves).toHaveBeenCalledTimes(attempts);
  expect(recoveryDelays).toEqual([1_000]);
  expect(notRetried()).toHaveLength(1);
  expect(preservedBatches(f)[0]).toMatchObject({
    reason: "storage-constraint",
    sessionId: f.id,
    events: [{ type: "approval.requested", requestId: 9, title: "Held approval" }],
  });
  // The original turn stays held: nothing durable says it ended.
  expect(f.engine.hasActiveRun(f.id)).toBe(true);
  expect((await f.store.session(f.id)).status).toBe("running");
});

it("writes the batch of a turn still held by recovery when the Host shuts down", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  let failing = true;
  failSaves(f, ["events", "settled", "interrupted"], "transient fixture", () => failing);
  await f.send();
  f.starts[0].input.onEvent({ type: "approval.requested", requestId: 11, title: "Late write" });
  // The turn is held with its first recovery still a second away.
  await vi.waitFor(() => expect(recoveryDelays).toEqual([1_000]), { timeout: 5_000 });
  failing = false;
  await f.engine.close().catch(() => {});
  expect(
    (await f.store.session(f.id)).session.blocks.some((block) => block.approval?.requestId === 11),
  ).toBe(true);
});
