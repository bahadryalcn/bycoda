import type { ChildProcessHandle } from "./child";

const MAX_OWNERS = 4096;
const MAX_FAMILIES = 64;
const KEEPER_KEY = "bycoda.providerRetirement.v1";
type Kill = (handle: ChildProcessHandle) => Promise<void>;
type RecordState = "active" | "retiring" | "failed" | "retired";
type Original = {
  handle: ChildProcessHandle;
  ownerKey: string;
  kill: Kill;
  state: RecordState;
  work: Promise<void> | undefined;
  error: unknown;
  settled: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type FamilyState = {
  records: Map<ChildProcessHandle, Original>;
  originals: WeakMap<ChildProcessHandle, Original>;
};
type Keeper = {
  version: 1;
  families: Map<string, FamilyState>;
  retained: number;
  errors: WeakSet<object>;
};
export type ProviderRetirementCohort = Readonly<{
  size: number;
  settled: Promise<void>;
  retire: () => Promise<void>;
}>;

function closedObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor;
    })
  );
}

/** Keep actual in-memory owners only. Serialized/unknown state is not a fresh
 * census, and must never silently erase failed or still-running originals. */
function keeperFor(data: Record<string, unknown>): Keeper {
  const descriptor = Object.getOwnPropertyDescriptor(data, KEEPER_KEY);
  if (!descriptor) {
    const keeper: Keeper = { version: 1, families: new Map(), retained: 0, errors: new WeakSet() };
    data[KEEPER_KEY] = keeper;
    return keeper;
  }
  const candidate: unknown = "value" in descriptor ? descriptor.value : undefined;
  if (
    !closedObject(candidate, ["version", "families", "retained", "errors"]) ||
    candidate.version !== 1 ||
    !(candidate.families instanceof Map) ||
    !(candidate.errors instanceof WeakSet) ||
    !Number.isInteger(candidate.retained) ||
    typeof candidate.retained !== "number" ||
    candidate.retained < 0 ||
    candidate.retained > MAX_OWNERS ||
    candidate.families.size > MAX_FAMILIES
  )
    throw new Error("Provider retirement keeper is unavailable");
  let count = 0;
  for (const [family, value] of candidate.families as Map<unknown, unknown>) {
    if (
      typeof family !== "string" ||
      !/^[a-z][a-z0-9.-]{0,63}$/.test(family) ||
      !closedObject(value, ["records", "originals"]) ||
      !(value.records instanceof Map) ||
      !(value.originals instanceof WeakMap)
    )
      throw new Error("Provider retirement keeper is unavailable");
    for (const [handle, entry] of value.records as Map<unknown, unknown>) {
      if (
        ++count > MAX_OWNERS ||
        !closedObject(entry, [
          "handle",
          "ownerKey",
          "kill",
          "state",
          "work",
          "error",
          "settled",
          "resolve",
          "reject",
        ]) ||
        !handle ||
        typeof handle !== "object" ||
        entry.handle !== handle ||
        typeof entry.ownerKey !== "string" ||
        typeof entry.kill !== "function" ||
        typeof entry.state !== "string" ||
        !["active", "retiring", "failed"].includes(entry.state) ||
        !(entry.settled instanceof Promise) ||
        typeof entry.resolve !== "function" ||
        typeof entry.reject !== "function" ||
        (entry.work !== undefined && !(entry.work instanceof Promise)) ||
        (entry.state !== "active" && !(entry.work instanceof Promise)) ||
        value.originals.get(handle) !== entry
      )
        throw new Error("Provider retirement keeper is unavailable");
    }
  }
  if (count !== candidate.retained) throw new Error("Provider retirement keeper is unavailable");
  return candidate as unknown as Keeper;
}

const defaultKeeper = keeperFor(import.meta.hot?.data ?? {});

export class ProviderRetirementError extends Error {
  readonly errors: readonly unknown[];
  constructor(
    readonly family: string,
    errors: unknown[],
    message = "Original provider retirement is not verified",
  ) {
    super(`${message} (${family})`);
    this.name = "ProviderRetirementError";
    this.errors = Object.freeze([...errors]);
    defaultKeeper.errors.add(this);
  }
}

function failure(
  keeper: Keeper,
  family: string,
  errors: unknown[],
  message?: string,
): ProviderRetirementError {
  const error = new ProviderRetirementError(family, errors, message);
  keeper.errors.add(error);
  return error;
}

function joined(keeper: Keeper, family: string, work: Promise<unknown>[]): Promise<void> {
  const result = Promise.allSettled(work).then((outcomes) => {
    const errors = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    if (errors.length) throw failure(keeper, family, errors);
  });
  void result.catch(() => {});
  return result;
}

function attempt(
  keeper: Keeper,
  family: string,
  shared: FamilyState,
  entry: Original,
): Promise<void> {
  if (entry.work) return entry.work;
  entry.state = "retiring";
  // Publish the promise and closed admission before invoking the captured Core
  // domain. Re-entrant/old module callers never choose a new handle or kill fn.
  entry.work = Promise.resolve()
    .then(async () => {
      try {
        await entry.kill(entry.handle);
      } catch (error) {
        throw failure(keeper, family, [error]);
      }
      entry.state = "retired";
      if (shared.records.delete(entry.handle)) keeper.retained--;
      entry.resolve();
    })
    .catch((error) => {
      entry.state = "failed";
      entry.error = error;
      entry.reject(error);
      throw error;
    });
  void entry.work.catch(() => {});
  return entry.work;
}
function joinOriginals(
  keeper: Keeper,
  family: string,
  shared: FamilyState,
  entries: Original[],
): Promise<void> {
  return joined(
    keeper,
    family,
    entries.map((entry) => attempt(keeper, family, shared, entry)),
  );
}
function cohort(
  keeper: Keeper,
  family: string,
  shared: FamilyState,
  ownerKey: string,
): ProviderRetirementCohort {
  const entries = [...shared.records.values()].filter((entry) => entry.ownerKey === ownerKey);
  return Object.freeze({
    size: entries.length,
    settled: joined(
      keeper,
      family,
      entries.map((entry) => entry.settled),
    ),
    retire: () => joinOriginals(keeper, family, shared, entries),
  });
}

/** A factory view keeps its immutable Core handle domain; shared census does
 * not retain views. Every entry captures its own view kill at source admission. */
export class ProviderRetirementLedger {
  constructor(
    readonly family: string,
    private readonly kill: Kill,
    private readonly keeper: Keeper,
    private readonly shared: FamilyState,
  ) {}
  assertReady(ownerKey: string): void {
    const blocked = [...this.shared.records.values()].filter(
      (entry) => entry.ownerKey === ownerKey && entry.state !== "active",
    );
    if (blocked.length)
      throw failure(
        this.keeper,
        this.family,
        blocked.map(
          (entry) => entry.error ?? new Error("Original provider retirement is still pending"),
        ),
      );
  }
  admit<T extends ChildProcessHandle>(handle: T, ownerKey = handle.sessionId): T {
    if (this.shared.originals.has(handle)) return handle;
    this.assertReady(ownerKey);
    this.capture(handle, ownerKey);
    return handle;
  }
  /** Reserve/publish B before changing A; source must await its captured A
   * cohort before any B effect. Failed predecessors never permit admission. */
  admitPending<T extends ChildProcessHandle>(handle: T, ownerKey = handle.sessionId): T {
    if (this.shared.originals.has(handle)) return handle;
    const failed = [...this.shared.records.values()].filter(
      (entry) => entry.ownerKey === ownerKey && entry.state === "failed",
    );
    if (failed.length)
      throw failure(
        this.keeper,
        this.family,
        failed.map((entry) => entry.error),
      );
    this.capture(handle, ownerKey);
    return handle;
  }
  private capture(handle: ChildProcessHandle, ownerKey: string): Original {
    const existing = this.shared.originals.get(handle);
    if (existing) return existing;
    if (this.keeper.retained >= MAX_OWNERS)
      throw failure(this.keeper, this.family, [], "Provider retirement owner capacity exhausted");
    let resolve!: () => void, reject!: (error: unknown) => void;
    const settled = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    void settled.catch(() => {});
    const entry: Original = {
      handle,
      ownerKey,
      kill: this.kill,
      state: "active",
      work: undefined,
      error: undefined,
      settled,
      resolve,
      reject,
    };
    this.shared.originals.set(handle, entry);
    this.shared.records.set(handle, entry);
    this.keeper.retained++;
    return entry;
  }
  retire(handles: Iterable<ChildProcessHandle | undefined | null>): Promise<void> {
    const entries = [
      ...new Set([...handles].filter((handle): handle is ChildProcessHandle => !!handle)),
    ].map((handle) => this.capture(handle, handle.sessionId));
    return joinOriginals(this.keeper, this.family, this.shared, entries);
  }
  retireOwner(
    ownerKey: string,
    handles: Iterable<ChildProcessHandle | undefined | null> = [],
  ): Promise<void> {
    for (const handle of handles) if (handle) this.capture(handle, ownerKey);
    return joinOriginals(
      this.keeper,
      this.family,
      this.shared,
      [...this.shared.records.values()].filter((entry) => entry.ownerKey === ownerKey),
    );
  }
  drain(ownerKey?: string): Promise<void> {
    return joinOriginals(
      this.keeper,
      this.family,
      this.shared,
      [...this.shared.records.values()].filter(
        (entry) =>
          entry.state !== "active" && (ownerKey === undefined || entry.ownerKey === ownerKey),
      ),
    );
  }
  cohort(ownerKey: string): ProviderRetirementCohort {
    return cohort(this.keeper, this.family, this.shared, ownerKey);
  }
  observation() {
    return observation(this.family, this.shared);
  }
}
function observation(family: string, shared: FamilyState) {
  const entries = [...shared.records.values()];
  return {
    family,
    active: entries.filter((entry) => entry.state === "active").length,
    pending: entries.filter((entry) => entry.state === "retiring").length,
    failed: entries.filter((entry) => entry.state === "failed").length,
  };
}
function classifyOptionalProbeError(keeper: Keeper, error: unknown): void {
  const pending: unknown[] = [error],
    seen = new Set<object>();
  let inspected = 0;
  while (pending.length) {
    if (++inspected > 128) throw error;
    const next = pending.pop();
    if (!next || typeof next !== "object") continue;
    if (
      keeper.errors.has(next) ||
      next instanceof ProviderRetirementError ||
      ("name" in next && next.name === "ProviderRetirementError")
    )
      throw error;
    if (seen.has(next)) continue;
    seen.add(next);
    if ("errors" in next && Array.isArray(next.errors)) {
      if (next.errors.length > 128 || pending.length + next.errors.length > 128) throw error;
      pending.push(...next.errors);
    }
  }
}

/** Source-only store composition also permits tests to exercise an actual
 * in-memory hot.data bag. It never accepts serialized records or clears owners. */
export function createProviderRetirementScope(data: Record<string, unknown>) {
  const keeper = keeperFor(data);
  return {
    createLedger(family: string, kill: Kill): ProviderRetirementLedger {
      if (!/^[a-z][a-z0-9.-]{0,63}$/.test(family))
        throw new Error("Provider retirement family is invalid");
      let shared = keeper.families.get(family);
      if (!shared) {
        if (keeper.families.size >= MAX_FAMILIES)
          throw failure(keeper, family, [], "Provider retirement family capacity exhausted");
        shared = { records: new Map(), originals: new WeakMap() };
        keeper.families.set(family, shared);
      }
      return new ProviderRetirementLedger(family, kill, keeper, shared);
    },
    captureCohort(ownerKey: string): ProviderRetirementCohort {
      const snapshots = [...keeper.families].map(([family, shared]) =>
        cohort(keeper, family, shared, ownerKey),
      );
      return Object.freeze({
        size: snapshots.reduce((size, value) => size + value.size, 0),
        settled: joined(
          keeper,
          "all",
          snapshots.map((value) => value.settled),
        ),
        retire: () =>
          joined(
            keeper,
            "all",
            snapshots.map((value) => value.retire()),
          ),
      });
    },
    drain(scope: { family?: string; ownerKey?: string } = {}): Promise<void> {
      return joined(
        keeper,
        scope.family ?? "all",
        [...keeper.families]
          .filter(([family]) => scope.family === undefined || scope.family === family)
          .map(([family, shared]) =>
            joinOriginals(
              keeper,
              family,
              shared,
              [...shared.records.values()].filter(
                (entry) =>
                  entry.state !== "active" &&
                  (scope.ownerKey === undefined || scope.ownerKey === entry.ownerKey),
              ),
            ),
          ),
      );
    },
    retireProcess(handle: ChildProcessHandle): Promise<void> {
      return joined(
        keeper,
        "all",
        [...keeper.families].map(([family, shared]) => {
          const entry = shared.originals.get(handle);
          return entry ? joinOriginals(keeper, family, shared, [entry]) : Promise.resolve();
        }),
      );
    },
    observation: () => [...keeper.families].map(([family, shared]) => observation(family, shared)),
    assertOptionalProbeError: (error: unknown) => classifyOptionalProbeError(keeper, error),
  };
}
const defaultScope = createProviderRetirementScope(
  import.meta.hot?.data ?? { [KEEPER_KEY]: defaultKeeper },
);
export function createProviderRetirementLedger(
  family: string,
  kill: Kill,
): ProviderRetirementLedger {
  return defaultScope.createLedger(family, kill);
}
export function drainProviderRetirements(
  scope: { family?: string; ownerKey?: string } = {},
): Promise<void> {
  return defaultScope.drain(scope);
}
export function providerRetirementObservation() {
  return defaultScope.observation();
}
export function captureProviderRetirementCohort(ownerKey: string): ProviderRetirementCohort {
  return defaultScope.captureCohort(ownerKey);
}
export function retireProviderOwner(ownerKey: string): Promise<void> {
  return defaultScope.captureCohort(ownerKey).retire();
}
export function retireProviderProcess(handle: ChildProcessHandle): Promise<void> {
  return defaultScope.retireProcess(handle);
}

export function settleProviderRetirements(work: Iterable<Promise<unknown>>): Promise<void> {
  return joined(defaultKeeper, "caller", [...work]);
}

/** A cancelled/read-only probe can fail as a domain operation after its actual
 * cleanup succeeded. Only that observer error is optional; retained retirement
 * failures still reject the stop that joins the probe. */
export async function observeProviderProbeCleanup(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (error) {
    assertOptionalProviderProbeError(error);
  }
}

/** Only fully classified domain/read failures may enter an optional fallback. */
export function assertOptionalProviderProbeError(error: unknown): void {
  classifyOptionalProbeError(defaultKeeper, error);
}

/** Preserve the primary error and every actual cleanup outcome for the caller. */
export async function preserveProviderFailure(
  error: unknown,
  cleanup: Promise<unknown>,
): Promise<never> {
  try {
    await cleanup;
  } catch (retirement) {
    throw new ProviderRetirementError(
      "operation",
      [error, retirement],
      "Provider operation and original retirement failed",
    );
  }
  throw error;
}

export async function withProviderRetirement<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<unknown>,
): Promise<T> {
  let value: T;
  try {
    value = await work();
  } catch (error) {
    return preserveProviderFailure(error, cleanup());
  }
  await cleanup();
  return value;
}
