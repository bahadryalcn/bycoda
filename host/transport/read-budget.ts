import { WS_LIMITS } from "../../src/shared/model/host-contracts";
import { HostDispatchError } from "./dispatch";

type Class = "read" | "control";
export type HostReadBudgetLimits = Pick<
  typeof WS_LIMITS,
  "maxReadJobs" | "maxReadJobsPerDevice" | "maxControlJobs" | "maxControlJobsPerDevice"
>;

/** Admission is tied to backend settlement, not a socket or request lifetime. */
export class HostReadWorkBudget {
  private readonly counts = { read: 0, control: 0 };
  private readonly principals = new Map<string, { read: number; control: number }>();

  constructor(private readonly limits: HostReadBudgetLimits = WS_LIMITS) {
    for (const value of Object.values(limits))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid Host work limit.");
  }

  run<T>(principal: string, action: () => Promise<T>, kind: Class = "read"): Promise<T> {
    const count = this.principals.get(principal) ?? { read: 0, control: 0 };
    const globalLimit = kind === "read" ? this.limits.maxReadJobs : this.limits.maxControlJobs;
    const principalLimit =
      kind === "read" ? this.limits.maxReadJobsPerDevice : this.limits.maxControlJobsPerDevice;
    if (this.counts[kind] >= globalLimit || count[kind] >= principalLimit)
      return Promise.reject(
        new HostDispatchError("overloaded", "Host read capacity is busy; retry later."),
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
