import {
  captureProviderRetirementCohort,
  drainProviderRetirements,
} from "../src/integrations/harness/core/providerRetirement";

type Release = (() => Promise<void>) | undefined;
type Cohort = ReturnType<typeof captureProviderRetirementCohort>;
export const PROVIDER_ACTIVITY_CAPACITY = 512;

function attempted(work: () => Promise<unknown>): Promise<unknown> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
}
async function joined(work: Iterable<Promise<unknown>>, message: string): Promise<void> {
  const outcomes = await Promise.allSettled(work);
  const errors = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (errors.length) throw new AggregateError(errors, message);
}

/** Own the actual release callback, independently of turn routing or an idle row. */
export class ProviderActivityRetirement {
  private startWork?: Promise<void>;
  private startSucceeded = false;
  private releaseCallback?: () => Promise<void>;
  private cohort?: Cohort;
  private retirementWork?: Promise<void>;
  private releaseWork?: Promise<void>;
  private bookkeepingWork?: Promise<unknown>;
  private bookkeepingDone = false;
  private resourceReleased = false;
  private error?: unknown;
  private failed = false;
  constructor(
    readonly ownerKey: string,
    private readonly released: () => void,
  ) {}

  start(acquire: () => Promise<Release>): Promise<void> {
    if (this.startWork) return this.startWork;
    // Host providers bypass the desktop registry: marked failures from another
    // same-owner family (for example a skill probe) must block before acquisition.
    this.startWork = drainProviderRetirements({ ownerKey: this.ownerKey })
      .then(() => attempted(acquire))
      .then((value) => {
        if (value !== undefined && typeof value !== "function")
          throw new Error("Original provider activity callback is unavailable");
        this.releaseCallback = value as Release;
        // No resource was acquired; this says nothing about provider completeness.
        if (!this.releaseCallback) this.resourceReleased = true;
        this.startSucceeded = true;
      })
      .catch((error) => {
        this.failed = true;
        throw error;
      });
    void this.startWork.catch(() => {});
    return this.startWork;
  }

  private capture(): Cohort {
    return (this.cohort ??= captureProviderRetirementCohort(this.ownerKey));
  }

  retire(stop: () => Promise<void>): Promise<void> {
    if (this.retirementWork) return this.retirementWork;
    const original = this.capture();
    const admitted = this.startWork;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.retirementWork = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    // The immutable cut precedes the wait. A pre-effect readiness/acquisition
    // refusal cannot become permission to stop existing provider work.
    const perform = () =>
      joined(
        [attempted(stop), attempted(() => original.retire())],
        "Original provider stop/retirement failed",
      );
    const work = this.startSucceeded
      ? perform()
      : admitted
        ? admitted.then(perform)
        : Promise.reject(new Error("Original provider activity has not started"));
    void work.then(resolve, (error) => {
      this.failed = true;
      reject(error);
    });
    void this.retirementWork.catch(() => {});
    return this.retirementWork;
  }

  release(): Promise<void> {
    if (!this.retirementWork)
      return Promise.reject(new Error("Original provider retirement has not started"));
    return this.releaseAfter(this.retirementWork);
  }

  /** Pure observation: late completion releases its own lease, never stops a newer child. */
  retainWarm(): Promise<void> {
    if (!this.startWork)
      return Promise.reject(new Error("Original provider activity has not started"));
    if (!this.releaseCallback) return this.startWork;
    const original = this.capture();
    // Empty snapshots retain the legacy resource-only API; they are not closure proof.
    return this.releaseAfter(original.size > 0 ? original.settled : Promise.resolve());
  }

  private releaseAfter(boundary: Promise<void>): Promise<void> {
    if (this.releaseWork) return this.releaseWork;
    this.releaseWork = (async () => {
      await this.startWork;
      await boundary;
      await this.releaseCallback?.();
      this.resourceReleased = true;
      this.forgetIfComplete();
    })().catch((error) => {
      this.failed = true;
      throw error;
    });
    void this.releaseWork.catch(() => {});
    return this.releaseWork;
  }

  async drain(): Promise<void> {
    const failures: unknown[] = [];
    const wait = async (work: Array<Promise<unknown> | undefined>) => {
      for (const result of await Promise.allSettled(
        work.filter((value): value is Promise<unknown> => !!value),
      ))
        if (result.status === "rejected") failures.push(result.reason);
    };
    await wait([this.startWork, this.bookkeepingWork]);
    // Background bookkeeping can install its original passive waiter while closing.
    await wait([this.retirementWork, this.releaseWork]);
    if (!this.bookkeepingDone)
      failures.push(
        this.error ?? new Error("Original provider bookkeeping awaits successful settlement"),
      );
    if (this.releaseCallback && !this.releaseWork)
      failures.push(new Error("Original provider activity awaits successful settlement"));
    if (failures.length)
      throw new AggregateError(failures, "Original provider activity cleanup failed");
  }
  trackBookkeeping(work: Promise<unknown>): void {
    this.bookkeepingWork = work;
    void work.catch(() => {});
  }
  bookkeepingFinished(): void {
    this.bookkeepingDone = true;
    this.forgetIfComplete();
  }
  recordFailure(error: unknown): void {
    this.failed = true;
    this.error ??= error;
  }
  private forgetIfComplete(): void {
    if (this.bookkeepingDone && this.resourceReleased) this.released();
  }
  observation() {
    return { failed: this.failed };
  }
}

export class ProviderActivityRetirements {
  private readonly records = new Set<ProviderActivityRetirement>();
  reserve(ownerKey: string, released?: () => void): ProviderActivityRetirement {
    if (
      [...this.records].some(
        (record) => record.ownerKey === ownerKey && record.observation().failed,
      )
    )
      throw new Error("Original provider activity cleanup is unverified");
    if (this.records.size >= PROVIDER_ACTIVITY_CAPACITY)
      throw new Error("Provider activity retirement capacity is held by unfinished work");
    const original = new ProviderActivityRetirement(ownerKey, () => {
      if (this.records.delete(original)) released?.();
    });
    this.records.add(original);
    return original;
  }
  drain(): Promise<void> {
    return joined(
      [...this.records].map((record) => record.drain()),
      "Retained provider activity cleanup failed",
    );
  }
  observation() {
    return {
      retained: this.records.size,
      failed: [...this.records].filter((record) => record.observation().failed).length,
    };
  }
}

/** Fresh owner intent only. Retain this result; never recapture a cohort on retry. */
export function stopCapturedProvider(ownerKey: string, stop: () => Promise<void>): Promise<void> {
  const original = captureProviderRetirementCohort(ownerKey);
  return joined(
    [attempted(stop), attempted(() => original.retire())],
    "Original provider stop/retirement failed",
  );
}
