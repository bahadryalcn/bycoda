import { expect, it, vi } from "vitest";
import type { ChildProcessHandle } from "./child";
import {
  createProviderRetirementLedger,
  createProviderRetirementScope,
  captureProviderRetirementCohort,
  drainProviderRetirements,
  retireProviderOwner,
  retireProviderProcess,
  ProviderRetirementError,
  withProviderRetirement,
  observeProviderProbeCleanup,
} from "./providerRetirement";

// Source-ledger protocol fixture only. These objects are never passed to real
// Core/Native IO and do not claim an OS construction or retirement proof.
const handle = (sessionId: string) => Object.freeze({ sessionId }) as ChildProcessHandle;
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("captures passive original A before B and retires only that immutable source cohort", async () => {
  const held = gate();
  const a = handle("snapshot-route"),
    b = handle("snapshot-route");
  const kill = vi.fn((original: ChildProcessHandle) =>
    original === a ? held.promise : Promise.resolve(),
  );
  const ledger = createProviderRetirementLedger("test.snapshot", kill);
  ledger.admit(a, "snapshot-owner");
  const cohort = captureProviderRetirementCohort("snapshot-owner");
  ledger.admit(b, "snapshot-owner");
  expect(Object.isFrozen(cohort)).toBe(true);
  expect(cohort.size).toBe(1);
  let settled = false;
  void cohort.settled.then(() => {
    settled = true;
  });
  await tick();
  expect(kill).not.toHaveBeenCalled();
  expect(settled).toBe(false);
  const retiring = cohort.retire();
  await tick();
  expect(kill.mock.calls.map(([original]) => original)).toEqual([a]);
  expect(settled).toBe(false);
  held.resolve();
  await retiring;
  await cohort.settled;
  await cohort.retire();
  expect(kill).toHaveBeenCalledOnce();
  expect(ledger.observation().active).toBe(1);
  await ledger.retire([b]);
  expect(kill.mock.calls.map(([original]) => original)).toEqual([a, b]);
});

it("joins every original before rejecting and retains failed A across second stop and next admission", async () => {
  const held = gate(),
    failure = new Error("original A retirement unknown");
  const a = handle("failure-route"),
    b = handle("failure-route"),
    unrelated = handle("other-route");
  const kill = vi.fn((original: ChildProcessHandle) =>
    original === a ? Promise.reject(failure) : original === b ? held.promise : Promise.resolve(),
  );
  const ledger = createProviderRetirementLedger("test.failure", kill);
  ledger.admit(a, "failure-owner");
  ledger.admit(b, "failure-owner");
  const cohort = captureProviderRetirementCohort("failure-owner");
  let finished = false;
  const first = cohort.retire().then(
    () => {
      finished = true;
      return undefined;
    },
    (error: unknown) => {
      finished = true;
      return error;
    },
  );
  await tick();
  expect(kill).toHaveBeenCalledTimes(2);
  expect(finished).toBe(false);
  expect(() => ledger.admit(handle("failure-route"), "failure-owner")).toThrow(
    ProviderRetirementError,
  );
  held.resolve();
  expect(await first).toBeInstanceOf(ProviderRetirementError);
  await expect(cohort.settled).rejects.toBeInstanceOf(ProviderRetirementError);
  await expect(cohort.retire()).rejects.toBeInstanceOf(ProviderRetirementError);
  await expect(retireProviderOwner("failure-owner")).rejects.toBeInstanceOf(
    ProviderRetirementError,
  );
  await expect(drainProviderRetirements({ family: "test.failure" })).rejects.toBeInstanceOf(
    ProviderRetirementError,
  );
  expect(kill).toHaveBeenCalledTimes(2);
  ledger.admit(unrelated, "unrelated-owner");
  await ledger.retireOwner("unrelated-owner");
  expect(kill).toHaveBeenLastCalledWith(unrelated);
  expect(ledger.observation()).toEqual({
    family: "test.failure",
    active: 0,
    pending: 0,
    failed: 1,
  });
});

it("natural source completion settles only the exact admitted handle and never a locator clone", async () => {
  const original = handle("natural-route"),
    clone = handle("natural-route"),
    held = gate();
  const kill = vi.fn(() => held.promise);
  const ledger = createProviderRetirementLedger("test.natural", kill);
  ledger.admit(original, "natural-owner");
  const cohort = captureProviderRetirementCohort("natural-owner");
  await retireProviderProcess(clone);
  expect(kill).not.toHaveBeenCalled();
  let settled = false;
  void cohort.settled.then(() => {
    settled = true;
  });
  const actual = retireProviderProcess(original);
  await tick();
  expect(kill).toHaveBeenCalledWith(original);
  expect(settled).toBe(false);
  held.resolve();
  await actual;
  await cohort.settled;
  expect(settled).toBe(true);
});

it("preserves primary failures and distinguishes optional probe observers from physical cleanup failure", async () => {
  const primary = new Error("probe cancelled"),
    physical = new Error("actual original drain failed");
  const ledger = createProviderRetirementLedger("test.primary", async () => {
    throw physical;
  });
  const original = ledger.admit(handle("primary-route"));
  const result = withProviderRetirement(
    async () => {
      throw primary;
    },
    () => ledger.retire([original]),
  );
  const error = await result.catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(ProviderRetirementError);
  expect((error as ProviderRetirementError).errors[0]).toBe(primary);
  await expect(observeProviderProbeCleanup(Promise.reject(primary))).resolves.toBeUndefined();
  await expect(observeProviderProbeCleanup(Promise.reject(error))).rejects.toBe(error);
  await expect(ledger.retire([original])).rejects.toBeInstanceOf(ProviderRetirementError);
});

it("prepublishes B behind captured pending A cleanup without retiring B or admitting after A failed", async () => {
  const held = gate();
  const a = handle("pending-original-route"),
    b = handle("pending-original-route");
  const kill = vi.fn((original: ChildProcessHandle) =>
    original === a ? held.promise : Promise.resolve(),
  );
  const ledger = createProviderRetirementLedger("test.prepublish", kill);
  ledger.admit(a);
  const captured = ledger.retire([a]);
  expect(() => ledger.admit(handle(a.sessionId))).toThrow(ProviderRetirementError);
  ledger.admitPending(b);
  const stoppingB = captureProviderRetirementCohort(a.sessionId);
  expect(stoppingB.size).toBe(2);
  await tick();
  expect(kill.mock.calls.map(([original]) => original)).toEqual([a]);
  held.resolve();
  await captured;
  expect(ledger.observation().active).toBe(1);
  await ledger.retire([b]);
  expect(kill.mock.calls.map(([original]) => original)).toEqual([a, b]);
  const failed = createProviderRetirementLedger("test.prepublish-failed", async () => {
    throw new Error("Original proof unknown");
  });
  const original = failed.admit(handle("pending-failed-route"));
  await expect(failed.retire([original])).rejects.toBeInstanceOf(ProviderRetirementError);
  expect(() => failed.admitPending(handle(original.sessionId))).toThrow(ProviderRetirementError);
});

it("refuses an optional probe classification that could truncate a late physical failure", async () => {
  const marker = new ProviderRetirementError("test.classifier", [
    new Error("original physical failure"),
  ]);
  const wide = {
    errors: [...Array.from({ length: 128 }, () => new Error("optional cancelled read")), marker],
  };
  await expect(observeProviderProbeCleanup(Promise.reject(wide))).rejects.toBe(wide);
  let deep: unknown = marker;
  for (let index = 0; index < 129; index++) deep = { errors: [deep] };
  await expect(observeProviderProbeCleanup(Promise.reject(deep))).rejects.toBe(deep);
  await expect(
    observeProviderProbeCleanup(Promise.reject({ errors: [new Error("optional read cancelled")] })),
  ).resolves.toBeUndefined();
});

it("retains immutable factory handle domains across future admissions from old and new module views", async () => {
  const data: Record<string, unknown> = {};
  const oldScope = createProviderRetirementScope(data);
  const a = handle("hmr-a"),
    b = handle("hmr-b"),
    c = handle("hmr-old-view-later-c");
  const oldDomain = new Set([a, c]),
    newDomain = new Set([b]);
  const oldKill = vi.fn(async (original: ChildProcessHandle) => {
    if (!oldDomain.has(original)) throw new Error("Unknown old Core construction");
  });
  const newKill = vi.fn(async (original: ChildProcessHandle) => {
    if (!newDomain.has(original)) throw new Error("Unknown new Core construction");
  });
  const oldView = oldScope.createLedger("test.hmr-domain", oldKill);
  oldView.admit(a, "hmr-owner");
  const newScope = createProviderRetirementScope(data);
  const newView = newScope.createLedger("test.hmr-domain", newKill);
  expect(newView).not.toBe(oldView);
  newView.admit(b, "hmr-owner");
  oldView.admit(c, "hmr-owner");
  expect(newScope.captureCohort("hmr-owner").size).toBe(3);
  await newView.retire([a, b, c]);
  expect(oldKill.mock.calls.map(([original]) => original)).toEqual([a, c]);
  expect(newKill.mock.calls.map(([original]) => original)).toEqual([b]);
  expect(oldScope.observation()).toEqual(newScope.observation());
  expect(newScope.observation()[0].active).toBe(0);
});

it("preserves actual failed census and old error identity in the keeper and refuses serialized recovery", async () => {
  const data: Record<string, unknown> = {};
  const oldScope = createProviderRetirementScope(data);
  const kill = vi.fn(async () => {
    throw new Error("Original Core proof unknown");
  });
  const view = oldScope.createLedger("test.hmr-failed", kill);
  const a = view.admit(handle("hmr-failed-owner"));
  const marker = (await view.retire([a]).catch((error: unknown) => error)) as Error;
  // An actual prior error object survives, even when its old constructor is
  // absent from the new module's instanceof chain and its display name changed.
  Object.setPrototypeOf(marker, Error.prototype);
  marker.name = "PriorModulePhysicalFailure";
  expect(marker).not.toBeInstanceOf(ProviderRetirementError);
  const restored = createProviderRetirementScope(data);
  expect(restored.observation()[0].failed).toBe(1);
  expect(() => restored.assertOptionalProbeError(marker)).toThrow(marker);
  const newView = restored.createLedger(
    "test.hmr-failed",
    vi.fn(async () => {}),
  );
  expect(() => newView.admitPending(handle(a.sessionId))).toThrow(ProviderRetirementError);
  await expect(restored.drain({ ownerKey: a.sessionId })).rejects.toBeInstanceOf(
    ProviderRetirementError,
  );
  expect(kill).toHaveBeenCalledOnce();
  const legacyMarker = new Error("Unrecognized old retirement failure");
  legacyMarker.name = "ProviderRetirementError";
  expect(() => restored.assertOptionalProbeError(legacyMarker)).toThrow(legacyMarker);
  const serialized = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  expect(() => createProviderRetirementScope(serialized)).toThrow("keeper is unavailable");
  expect(restored.observation()[0].failed).toBe(1);
});

it("keeps actual owner capacity across keeper reuse and refuses B admission before any A cleanup effect", async () => {
  const data: Record<string, unknown> = {};
  const scope = createProviderRetirementScope(data);
  const kill = vi.fn(async () => {});
  const view = scope.createLedger("test.hmr-capacity", kill);
  const originals = Array.from({ length: 4096 }, (_, index) =>
    view.admit(handle(`capacity-${index}`)),
  );
  const restored = createProviderRetirementScope(data);
  const newView = restored.createLedger(
    "test.hmr-capacity",
    vi.fn(async () => {}),
  );
  expect(() => newView.admitPending(handle("capacity-b"))).toThrow("capacity exhausted");
  expect(kill).not.toHaveBeenCalled();
  expect(restored.captureCohort("capacity-0").size).toBe(1);
  expect(restored.observation()[0].active).toBe(4096);
  await newView.retire(originals);
  expect(kill).toHaveBeenCalledTimes(4096);
  expect(restored.observation()[0].active).toBe(0);
});
