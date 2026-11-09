import { WS_LIMITS } from "../../src/shared/model/host-contracts";
import { HostDispatchError } from "./dispatch";

type Class = "read" | "control";
export type HostReadBudgetLimits = {
  [
    K in "maxReadJobs" | "maxReadJobsPerDevice" | "maxControlJobs" | "maxControlJobsPerDevice"
  ]: number;
};

/** Admission is tied to backend settlement, not a socket or request lifetime. */
export class HostReadWorkBudget {
  private readonly counts = { read: 0, control: 0 };
  private readonly principals = new Map<string, { read: number; control: number }>();
  private readonly inFlight = new Map<string, { work: Promise<unknown>; started: number }>();

  constructor(private readonly limits: HostReadBudgetLimits = WS_LIMITS) {
    for (const value of Object.values(limits))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid Host work limit.");
  }

  /** One dispatch and its first physical child share a lease until both settle. */
  runScoped<T>(
    principal: string,
    action: (track: <U>(work: () => Promise<U>) => Promise<U>) => Promise<T>,
    kind: Class = "read",
  ): Promise<T> {
    return this.run(
      principal,
      async () => {
        let open = true;
        let borrowed = false;
        let childSettled: Promise<void> | undefined;
        const track = <U>(work: () => Promise<U>): Promise<U> => {
          if (!open)
            return Promise.reject(
              new HostDispatchError("cancelled", "Host work admission closed."),
            );
          if (borrowed) return this.run(principal, work, kind);
          borrowed = true;
          let child: Promise<U>;
          try {
            child = Promise.resolve(work());
          } catch (error) {
            child = Promise.reject(error);
          }
          childSettled = child.then(
            () => {},
            () => {},
          );
          return child;
        };
        try {
          return await action(track);
        } finally {
          open = false;
          await childSettled;
        }
      },
      kind,
    );
  }

  /**
   * Concurrent callers for one principal join the check already in flight and share its
   * single slot. Per-request device authorization uses this: a burst of reads (a phone
   * opening a session) otherwise exhausts the per-device control slots and fails as busy.
   * Only a check younger than `maxAgeMs` is joined (the store's own auth cache TTL), so a
   * stalled check never answers for requests that arrive long after it started.
   */
  runShared<T>(principal: string, action: () => Promise<T>, maxAgeMs = 1_500): Promise<T> {
    const current = this.inFlight.get(principal);
    if (current && Date.now() - current.started < maxAgeMs) return current.work as Promise<T>;
    const work = this.run(principal, action, "control");
    const entry = { work, started: Date.now() };
    this.inFlight.set(principal, entry);
    const clear = () => {
      if (this.inFlight.get(principal) === entry) this.inFlight.delete(principal);
    };
    work.then(clear, clear);
    return work;
  }

  run<T>(principal: string, action: () => Promise<T>, kind: Class = "read"): Promise<T> {
    const count = this.principals.get(principal) ?? { read: 0, control: 0 };
    const globalLimit = kind === "read" ? this.limits.maxReadJobs : this.limits.maxControlJobs;
    const principalLimit =
      kind === "read" ? this.limits.maxReadJobsPerDevice : this.limits.maxControlJobsPerDevice;
    if (this.counts[kind] >= globalLimit || count[kind] >= principalLimit)
      return Promise.reject(
        new HostDispatchError("overloaded", "Host read capacity is busy; retry later.", undefined, {
          category: "overload",
          retryable: true,
          delivery: "not-sent",
        }),
      );
    this.counts[kind]++;
    count[kind]++;
    this.principals.set(principal, count);
    const release = () => {
      this.counts[kind]--;
      count[kind]--;
      if (!count.read && !count.control) this.principals.delete(principal);
    };
    let work: Promise<T>;
    try {
      work = Promise.resolve(action());
    } catch (error) {
      release();
      return Promise.reject(error);
    }
    return work.then(
      (value) => {
        release();
        return value;
      },
      (error: unknown) => {
        release();
        throw error;
      },
    );
  }
}
