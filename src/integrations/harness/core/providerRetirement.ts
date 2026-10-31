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
/** `includeFamily` narrows a drain to the families it returns true for. */
type DrainScope = { family?: string; ownerKey?: string; includeFamily?: (family: string) => boolean };
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

/** Wait for every original, then surface unsafe unfinished retirement. */
function joined(keeper: Keeper, family: string, work: Promise<unknown>[]): Promise<void> {
  return Promise.allSettled(work).then((outcomes) => {
    const errors = outcomes.flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason] : []);
    if (errors.length) throw failure(keeper, family, errors, "The previous provider has not stopped yet. Retry in a moment");
  });
}

const KILL_WAIT_MS = 20_000;
/** When each actual kill began, so a later caller waits only for what is left of
 * the budget instead of starting another full one behind the first caller. */
const killStartedAt = new WeakMap<Original, number>();
const MIN_LATE_WAIT_MS = 1_000;

function attempt(
  keeper: Keeper,
  family: string,
  shared: FamilyState,
  entry: Original,
): Promise<void> {
  if (entry.state === "retired") return Promise.resolve();
  if (!entry.work || entry.state === "failed") {
    entry.state = "retiring";
    killStartedAt.set(entry, Date.now());
    entry.work = Promise.resolve().then(() => entry.kill(entry.handle)).then(() => {
      entry.state = "retired";
      entry.error = undefined;
      if (shared.records.delete(entry.handle)) keeper.retained--;
      entry.resolve();
    }, (error: unknown) => {
      entry.state = "failed";
      entry.error = error;
      console.warn(`[providerRetirement] kill failed (${family}); retry remains available`, error);
      throw error;
    });
    void entry.work.catch(() => {});
  }
  // A deadline bounds this caller, never the actual kill or its ownership record.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remaining = Math.max(
    MIN_LATE_WAIT_MS,
    KILL_WAIT_MS - (Date.now() - (killStartedAt.get(entry) ?? Date.now())),
  );
  return Promise.race([
    entry.work,
    new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The previous provider is still stopping. Retry in a moment.")), remaining);
    }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
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
  /** Admission reserves only a handle; drain/retire gates the actual effect. */
  assertReady(_ownerKey: string): void {}
  admit<T extends ChildProcessHandle>(handle: T, ownerKey = handle.sessionId): T {
    if (this.shared.originals.has(handle)) return handle;
    this.capture(handle, ownerKey);
    return handle;
  }
  /** Reserve/publish B before changing A; source awaits its captured A cohort
   * (best-effort) before any B effect. */
  admitPending<T extends ChildProcessHandle>(handle: T, ownerKey = handle.sessionId): T {
    return this.admit(handle, ownerKey);
  }
  private capture(handle: ChildProcessHandle, ownerKey: string): Original {
    const existing = this.shared.originals.get(handle);
    if (existing) return existing;
    if (this.keeper.retained >= MAX_OWNERS) this.evictSettled();
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
  /** Only successfully retired originals may be evicted. */
  private evictSettled(): void {
    for (const [handle, entry] of this.shared.records) {
      if (entry.state !== "retired") continue;
      this.shared.records.delete(handle);
      this.keeper.retained--;
      if (this.keeper.retained < MAX_OWNERS) return;
    }
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
/** Cleanup errors are never fatal to an optional probe; nothing to rethrow. */
function classifyOptionalProbeError(_keeper: Keeper, _error: unknown): void {}

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
    drain(scope: DrainScope = {}): Promise<void> {
      return joined(
        keeper,
        scope.family ?? "all",
        [...keeper.families]
          .filter(([family]) => scope.family === undefined || scope.family === family)
          .filter(([family]) => scope.includeFamily?.(family) ?? true)
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
export function drainProviderRetirements(scope: DrainScope = {}): Promise<void> {
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

/** Rethrow the ORIGINAL error; a cleanup failure is warned and attached as cause. */
export async function preserveProviderFailure(
  error: unknown,
  cleanup: Promise<unknown>,
): Promise<never> {
  try {
    await cleanup;
  } catch (retirement) {
    console.warn("[providerRetirement] cleanup after failure also failed", retirement);
    if (error instanceof Error && !("cause" in error)) {
      try {
        Object.defineProperty(error, "cause", { value: retirement, configurable: true });
      } catch {
        // frozen error: the warning above is enough
      }
    }
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
    return preserveProviderFailure(error, Promise.resolve().then(cleanup));
  }
  try {
    await cleanup();
  } catch (error) {
    console.warn("[providerRetirement] cleanup failed after completed work", error);
  }
  return value;
}
