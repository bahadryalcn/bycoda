import { afterEach, expect, it, vi } from "vitest";
import { createMountedComposerRegistry } from "./composerClosure";
import { PersistenceDrainRegistry } from "./persistenceDrain";
import { persistableDraft, type ComposerDraft } from "../model/draftPersistence";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const empty = (): ComposerDraft => ({ text: "", attachments: [], mcpTags: [] });
function fixture() {
  const registry = new PersistenceDrainRegistry();
  const publish = vi.fn(async (_id: string, _snapshot: Readonly<ComposerDraft>) => {});
  const mounted = createMountedComposerRegistry({ registry, publish });
  let snapshot = empty();
  const gate = vi.fn();
  const lease = mounted.registerMountedComposer({ sessionId: "a", snapshot: () => snapshot, gate });
  const owner = {};
  return {
    ...mounted,
    registry,
    publish,
    lease,
    owner,
    gate,
    set(value: ComposerDraft) {
      snapshot = value;
    },
    snapshot: () => snapshot,
  };
}
afterEach(() => vi.useRealTimers());

it("retains exact immutable whitespace, tags and mode independently of legacy empty serialization", async () => {
  const f = fixture();
  const value = {
    text: " \n\t",
    mcpTags: [{ id: "server", name: "mcp", provider: "claude", serverName: "mcp" }],
    attachments: [],
    mode: "save",
  } as unknown as ComposerDraft;
  f.set(value);
  expect(persistableDraft(value)).toBeNull();
  const closure = f.beginComposerClosure(["a"], { owner: f.owner });
  const first = closure.captureAndFlush();
  expect(closure.captureAndFlush()).toBe(first);
  const result = await first;
  expect(result.qualified).toBe(false);
  expect(result.snapshots[0].snapshot).toEqual(value);
  expect(Object.isFrozen(result.snapshots[0].snapshot.mcpTags)).toBe(true);
  value.text = "later external data";
  expect(result.snapshots[0].snapshot.text).toBe(" \n\t");
  closure.reopen(f.owner);
});

it("owns preparation before its first await and rejects new factories while only its target is closed", async () => {
  const f = fixture();
  const held = deferred();
  let started = false;
  const operation = f.lease.prepare(async (accepted) => {
    started = true;
    await held.promise;
    accepted.apply(() => f.set({ ...empty(), text: "accepted result" }));
  });
  expect(started).toBe(true);
  const closure = f.beginComposerClosure(["a"], { owner: f.owner });
  const capture = closure.captureAndFlush();
  const refused = vi.fn(async () => {});
  await expect(f.lease.prepare(refused)).rejects.toMatchObject({ code: "closed" });
  expect(refused).not.toHaveBeenCalled();
  const other = f.registerMountedComposer({ sessionId: "b", snapshot: empty });
  expect(other.mutate(() => "unrelated works")).toBe("unrelated works");
  expect(f.observation().active).toBe(1);
  held.resolve();
  await operation;
  expect((await capture).snapshots[0].snapshot.text).toBe("accepted result");
  expect(f.publish).toHaveBeenCalledWith(
    "a",
    expect.objectContaining({ text: "accepted result" }),
    expect.anything(),
  );
  closure.reopen(f.owner);
});

it("keeps failed accepted preparation strict and retries the same immutable operation before recapture", async () => {
  const f = fixture();
  let attempts = 0;
  await expect(
    f.lease.prepare(async (accepted) => {
      if (++attempts === 1) throw new Error("attachment unavailable");
      accepted.apply(() => f.set({ ...empty(), text: "recovered original intent" }));
    }),
  ).rejects.toThrow("attachment unavailable");
  const closure = f.beginComposerClosure(["a"], { owner: f.owner });
  await expect(closure.captureAndFlush()).rejects.toThrow("attachment unavailable");
  await f.lease.retryFailed();
  const result = await closure.captureAndFlush();
  expect(result.snapshots[0].snapshot.text).toBe("recovered original intent");
  expect(attempts).toBe(2);
  closure.reopen(f.owner);
});

it("retires a view without releasing accepted work or losing its late result", async () => {
  const f = fixture();
  const held = deferred();
  const accepted = f.lease.prepare(async (work) => {
    await held.promise;
    work.apply(() => f.set({ ...empty(), text: "late retained bytes" }));
  });
  const retirement = f.lease.retire();
  expect(f.lease.retired).toBe(true);
  expect(f.observation().active).toBe(1);
  expect(() => f.lease.mutate(() => {})).toThrow("retired");
  held.resolve();
  await accepted;
  await retirement;
  expect(f.publish).toHaveBeenLastCalledWith(
    "a",
    expect.objectContaining({ text: "late retained bytes" }),
    expect.anything(),
  );
});

it("a timed-out waiter leaves actual job ownership intact and only the exact owner reopens", async () => {
  const f = fixture();
  const held = deferred();
  const accepted = f.lease.prepare(async () => {
    await held.promise;
  });
  const closure = f.beginComposerClosure(["a"], { owner: f.owner, timeoutMs: 5 });
  await expect(closure.captureAndFlush()).rejects.toMatchObject({ code: "deadline" });
  expect(f.observation()).toMatchObject({ active: 1, closures: 1 });
  expect(() => closure.reopen({})).toThrow("wrong-owner");
  expect(f.lease.canMutate()).toBe(false);
  closure.reopen(f.owner);
  expect(f.lease.canMutate()).toBe(true);
  held.resolve();
  await accepted;
  expect(f.observation().active).toBe(0);
});

it("new registration invalidates the captured roster and exact reopen also releases its gate", async () => {
  const f = fixture();
  const closure = f.beginComposerClosure(["a"], { owner: f.owner });
  const gate = vi.fn();
  const next = f.registerMountedComposer({ sessionId: "a", snapshot: empty, gate });
  expect(gate).toHaveBeenLastCalledWith(true);
  await expect(closure.captureAndFlush()).rejects.toMatchObject({ code: "changed" });
  closure.reopen(f.owner);
  expect(next.canMutate()).toBe(true);
  expect(gate).toHaveBeenLastCalledWith(false);
});

it("never publishes an old retired result over a newer binding's changed draft", async () => {
  const f = fixture();
  const held = deferred();
  const accepted = f.lease.prepare(async (work) => {
    await held.promise;
    work.apply(() => f.set({ ...empty(), text: "old accepted material" }));
  });
  const rejected = expect(accepted).rejects.toMatchObject({ code: "changed" });
  const retired = f.lease.retire();
  const failedRetirement = expect(retired).rejects.toMatchObject({ code: "changed" });
  let newer = { ...empty(), text: "newer user draft" };
  const next = f.registerMountedComposer({ sessionId: "a", snapshot: () => newer });
  next.mutate(() => {
    newer = { ...newer, text: "newer user draft preserved" };
  });
  held.resolve();
  await rejected;
  await failedRetirement;
  expect(f.publish).not.toHaveBeenCalled();
  expect(newer.text).toBe("newer user draft preserved");
  expect(f.observation().retainedBytes).toBeGreaterThan(0);
});

it("an IME composition cannot be committed or discarded to manufacture capture", async () => {
  const f = fixture();
  f.registerMountedComposer({ sessionId: "b", snapshot: empty, composing: () => true });
  const closure = f.beginComposerClosure(["b"], { owner: f.owner });
  await expect(closure.captureAndFlush()).rejects.toMatchObject({ code: "composition" });
  expect(f.publish).not.toHaveBeenCalled();
  closure.reopen(f.owner);
});

it("a Native persistence retry never invokes an already applied preparation factory twice", async () => {
  const f = fixture();
  const read = vi.fn(async (work) =>
    work.apply(() => f.set({ ...empty(), text: "already read bytes" })),
  );
  f.publish.mockRejectedValueOnce(new Error("lost draft ACK"));
  await expect(f.lease.prepare(read)).rejects.toThrow("lost draft ACK");
  await f.lease.retryFailed();
  expect(read).toHaveBeenCalledOnce();
  expect(f.publish).toHaveBeenCalledTimes(2);
});

it("repeated retry callers join one actual retry until its settlement", async () => {
  const f = fixture();
  f.publish.mockRejectedValueOnce(new Error("Native pending"));
  await expect(f.lease.prepare(async () => {})).rejects.toThrow("Native pending");
  const held = deferred();
  f.publish.mockImplementation(async () => {
    await held.promise;
  });
  const retry = f.lease.retryFailed();
  for (let count = 0; count < 100; count++) expect(f.lease.retryFailed()).toBe(retry);
  expect(f.observation().active).toBe(1);
  held.resolve();
  await retry;
  expect(f.publish).toHaveBeenCalledTimes(2);
});

it("global actual-operation and per-mount slots reject before a new factory and release at actual settlement", async () => {
  const f = fixture();
  const held = deferred();
  const leases = [
    f.lease,
    ...Array.from({ length: 3 }, (_, index) =>
      f.registerMountedComposer({ sessionId: `other-${index}`, snapshot: empty }),
    ),
  ];
  const pending = leases.flatMap((lease) =>
    Array.from({ length: 16 }, () =>
      lease.prepare(async () => {
        await held.promise;
      }),
    ),
  );
  expect(f.observation().active).toBe(64);
  const forbidden = vi.fn(async () => {});
  await expect(leases[0].prepare(forbidden)).rejects.toMatchObject({ code: "capacity" });
  expect(forbidden).not.toHaveBeenCalled();
  held.resolve();
  await Promise.all(pending);
  expect(f.observation().active).toBe(0);
  await leases[0].prepare(forbidden);
  expect(forbidden).toHaveBeenCalledOnce();
});

it("compacts fully settled identical remounts without evicting a different or failed retained snapshot", async () => {
  const f = fixture();
  let lease = f.lease;
  for (let index = 0; index < 260; index++) {
    await lease.retire();
    lease = f.registerMountedComposer({ sessionId: "a", snapshot: empty });
  }
  expect(f.observation().bindings).toBe(1);
});

it("a genuinely new module implementation retains old jobs while retiring old admissions", async () => {
  const original = await import("./composerClosure");
  const held = deferred();
  let value = empty();
  const before = original.registerMountedComposer({ snapshot: () => value });
  const operation = before.prepare(async (accepted) => {
    await held.promise;
    accepted.apply(() => {
      value = { ...empty(), text: "old accepted job survives HMR" };
    });
  });
  const reloaded = await import("./composerClosure?mounted-implementation-reload");
  expect(before.canMutate()).toBe(false);
  expect(reloaded.mountedComposerObservation().active).toBe(1);
  const after = reloaded.registerMountedComposer({ snapshot: () => value });
  held.resolve();
  await operation;
  expect(after.canMutate()).toBe(true);
  const owner = {};
  const closure = reloaded.beginComposerClosure("profile", { owner });
  expect(
    (await closure.captureAndFlush()).snapshots.some((entry) => entry.snapshot.text === value.text),
  ).toBe(true);
  closure.reopen(owner);
  await before.retire();
  await after.retire();
});
