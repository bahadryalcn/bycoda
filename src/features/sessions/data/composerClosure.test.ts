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

it("keeps an original non-replayable action charged through finish and the later capture ACK", async () => {
  const f = fixture();
  const ack = deferred();
  f.publish.mockImplementation(async () => ack.promise);
  const action = f.lease.admitAction()!;
  expect(action).not.toBeNull();
  expect(f.lease.pending).toBe(true);
  const closure = f.beginComposerClosure(["a"], { owner: f.owner });
  expect(f.lease.admitAction()).toBeNull();
  let complete = false;
  const capture = closure.captureAndFlush().then((value) => {
    complete = true;
    return value;
  });
  action.apply(() => f.lease.mutate(() => f.set({ ...empty(), text: "original action" })));
  expect(f.publish).not.toHaveBeenCalled();
  expect(complete).toBe(false);
  action.finish();
  action.finish();
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledOnce());
  expect(complete).toBe(false);
  expect(() => action.apply(() => f.set(empty()))).toThrow("retired");
  ack.resolve();
  expect((await capture).snapshots[0].snapshot.text).toBe("original action");
  expect(f.observation().active).toBe(0);
  closure.reopen(f.owner);
});

it("never puts an action effect or its unknown exception into draft preparation retries", async () => {
  const f = fixture();
  const action = f.lease.admitAction()!;
  const effect = vi.fn(() => {
    throw new Error("effect outcome unknown");
  });
  expect(() => action.apply(effect)).toThrow("effect outcome unknown");
  action.finish();
  await vi.waitFor(() => expect(f.observation().active).toBe(0));
  expect(f.publish).not.toHaveBeenCalled();
  f.publish.mockRejectedValueOnce(new Error("draft ACK unknown"));
  await expect(f.lease.prepare(async () => {})).rejects.toThrow("draft ACK unknown");
  await f.lease.retryFailed();
  await f.lease.retryFailed();
  expect(effect).toHaveBeenCalledOnce();
  expect(f.publish).toHaveBeenCalledTimes(2);
});

it("restricts action lineage to its original binding and synchronous application", async () => {
  const f = fixture();
  const other = f.registerMountedComposer({ sessionId: "b", snapshot: empty });
  const action = f.lease.admitAction()!;
  const closure = f.beginComposerClosure("profile", { owner: f.owner });
  const afterAwait = action.apply(() => {
    expect(f.lease.canMutate()).toBe(true);
    expect(f.lease.publishCache(() => {})).toBe(true);
    expect(other.canMutate()).toBe(false);
    return Promise.resolve().then(() => {
      expect(f.lease.canMutate()).toBe(false);
      expect(f.lease.publishCache(() => {})).toBe(false);
      expect(() => f.lease.mutate(() => {})).toThrow("closed");
    });
  });
  await afterAwait;
  expect(f.lease.pending).toBe(true);
  action.finish();
  await vi.waitFor(() => expect(f.observation().active).toBe(0));
  closure.reopen(f.owner);
});

it("shares bounded preparation slots with actions and releases only actual settled capacity", async () => {
  const f = fixture();
  const actions = Array.from({ length: 16 }, () => f.lease.admitAction()!);
  expect(actions.every(Boolean)).toBe(true);
  expect(f.lease.admitAction()).toBeNull();
  const refused = vi.fn(async () => {});
  await expect(f.lease.prepare(refused)).rejects.toMatchObject({ code: "capacity" });
  expect(refused).not.toHaveBeenCalled();
  actions[0].finish();
  await vi.waitFor(() => expect(f.observation().active).toBe(15));
  await f.lease.prepare(refused);
  expect(refused).toHaveBeenCalledOnce();
  for (const action of actions) action.finish();
  await vi.waitFor(() => expect(f.observation().active).toBe(0));
});

it("retains actual action work through retirement without granting a disposed view mutation", async () => {
  const f = fixture();
  const action = f.lease.admitAction()!;
  let retired = false;
  const retirement = f.lease.retire().then(() => {
    retired = true;
  });
  expect(f.lease.admitAction()).toBeNull();
  expect(() => action.apply(() => f.set(empty()))).toThrow("retired");
  await Promise.resolve();
  expect(retired).toBe(false);
  expect(f.publish).not.toHaveBeenCalled();
  action.finish();
  await retirement;
  expect(f.observation().active).toBe(0);
});

it("keeps original attempt settlement pending through its real Native draft acknowledgement", async () => {
  const f = fixture();
  const ack = deferred();
  f.publish.mockImplementation(async () => ack.promise);
  let settled!: Promise<void>;
  let complete = false;
  const work = f.lease.prepare(async (accepted) => {
    settled = accepted.whenSettled!();
    void settled.then(() => {
      complete = true;
    });
    accepted.apply(() => f.set({ ...empty(), text: "accepted original" }));
  });
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledOnce());
  expect(complete).toBe(false);
  expect(f.lease.pending).toBe(true);
  ack.resolve();
  await work;
  await settled;
  expect(complete).toBe(true);
  expect(f.lease.pending).toBe(false);
});

it("binds explicit preparation retries to separate actual per-attempt settlement", async () => {
  const f = fixture();
  const ack = deferred();
  f.publish.mockImplementation(async () => ack.promise);
  const completions: Promise<void>[] = [];
  let attempts = 0;
  await expect(
    f.lease.prepare(async (accepted) => {
      completions.push(accepted.whenSettled!());
      if (++attempts === 1) throw new Error("actual preparation failed");
      accepted.apply(() => f.set({ ...empty(), text: "original retry" }));
    }),
  ).rejects.toThrow("actual preparation failed");
  await expect(completions[0]).rejects.toThrow("actual preparation failed");
  const retry = f.lease.retryFailed();
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledOnce());
  expect(completions).toHaveLength(2);
  expect(completions[1]).not.toBe(completions[0]);
  let retrySettled = false;
  void completions[1]!.then(() => {
    retrySettled = true;
  });
  await Promise.resolve();
  expect(retrySettled).toBe(false);
  ack.resolve();
  await retry;
  await completions[1];
  expect(retrySettled).toBe(true);
});

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
  const action = before.admitAction()!;
  const operation = before.prepare(async (accepted) => {
    await held.promise;
    accepted.apply(() => {
      value = { ...empty(), text: "old accepted job survives HMR" };
    });
  });
  const reloaded = await import("./composerClosure?mounted-implementation-reload");
  expect(before.canMutate()).toBe(false);
  expect(reloaded.mountedComposerObservation().active).toBe(2);
  expect(() => action.apply(() => {})).toThrow("retired");
  const after = reloaded.registerMountedComposer({ snapshot: () => value });
  expect(after.admitAction()).toBeNull();
  held.resolve();
  await operation;
  expect(after.canMutate()).toBe(true);
  const owner = {};
  const closure = reloaded.beginComposerClosure("profile", { owner });
  const capture = closure.captureAndFlush();
  action.finish();
  expect((await capture).snapshots.some((entry) => entry.snapshot.text === value.text)).toBe(true);
  closure.reopen(owner);
  await before.retire();
  await after.retire();
});

it("does not inspect a reused adapter's DOM or IME state after the original lease retired", async () => {
  const registry = new PersistenceDrainRegistry();
  const mounted = createMountedComposerRegistry({ registry, publish: async () => {} });
  const snapshot = vi.fn(() => ({ ...empty(), text: "retired original raw" }));
  const composing = vi.fn(() => false);
  const lease = mounted.registerMountedComposer({ sessionId: "retired", snapshot, composing });
  await lease.retire();
  snapshot.mockClear().mockImplementation(() => {
    throw new Error("foreign reused DOM read");
  });
  composing.mockClear().mockImplementation(() => {
    throw new Error("foreign reused IME read");
  });
  const owner = {},
    closure = mounted.beginComposerClosure(["retired"], { owner });
  try {
    expect((await closure.captureAndFlush()).snapshots[0].snapshot.text).toBe(
      "retired original raw",
    );
    expect(() => closure.assertCurrent()).not.toThrow();
    expect(snapshot).not.toHaveBeenCalled();
    expect(composing).not.toHaveBeenCalled();
  } finally {
    closure.reopen(owner);
  }
});

it("does not erase a sparse-array length change while comparing retained immutable draft data", async () => {
  const f = fixture();
  f.set({ ...empty(), mcpTags: Array(1) });
  const closure = f.beginComposerClosure(["a"], { owner: f.owner });
  try {
    await closure.captureAndFlush();
    f.set(empty());
    expect(() => closure.assertCurrent()).toThrow("changed");
  } finally {
    closure.reopen(f.owner);
  }
});
