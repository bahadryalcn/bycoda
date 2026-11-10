import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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
import { HostStore } from "./store";

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

it("settles a turn as interrupted when its pending events were built on a superseded revision", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const receipt = await f.send();
  const settled = deferred<{ interrupted?: boolean; reason?: string }>();
  f.engine.onSettled = (_id, outcome) => settled.resolve(outcome);
  // A direct store write leaves the live turn one revision behind the persisted head.
  await stamp(f);
  f.starts[0].input.onEvent({ type: "approval.requested", requestId: 7, title: "Unwritable" });
  expect(await settled.promise).toMatchObject({ interrupted: true });
  await f.engine.waitForRun(f.id, receipt.runId).catch(() => {});
  expect((await f.store.session(f.id)).status).toBe("interrupted");
  expect(f.engine.hasActiveRun(f.id)).toBe(false);
  expect(f.provider.stop).toHaveBeenCalled();
});
