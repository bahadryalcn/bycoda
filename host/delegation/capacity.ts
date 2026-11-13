import { HostLimits } from "../limits";
import type { HostStore } from "../store";
import { WorkStorage } from "../work/storage";
import type { DelegationRecord } from "./store";

/** Refuse only a child that cannot start until its exact live parent retires. */
export async function refuseSingleSlotChild(store: HostStore, record: DelegationRecord) {
  if (!record.rootWorkId || !store.db) return false;
  const storage = new WorkStorage(store, Date.now);
  const limits = new HostLimits(store);
  await storage.ready;
  await limits.settings();
  return store.transaction(async () => {
    if ((await limits.settings()).maxRunningTasks !== 1) return false;
    const parent = await store.session(record.parentSessionId);
    if (parent.status !== "running" || !parent.runId) return false;
    const work = await storage.list();
    if (
      !work.some(
        (item) =>
          item.reserved &&
          item.receipt?.sessionId === record.parentSessionId &&
          item.receipt.runId === parent.runId,
      )
    )
      return false;
    const child = work.find(
      (item) =>
        item.source.kind === `delegation.${record.kind}` &&
        item.source.id === record.runId &&
        item.source.occurrence === record.requestKey,
    );
    // A dispatched or uncertain child may already have effects; never retire it here.
    if (
      child &&
      (child.reserved || child.dispatchStarted || child.receipt || child.state === "unknown")
    )
      return false;
    if (child && child.state !== "completed")
      await storage.save({
        ...child,
        state: "completed",
        stopRequested: true,
        reserved: false,
        outcome: { status: "cancelled" },
        wait: undefined,
      });
    return !child || child.outcome?.status !== "succeeded";
  }, "critical");
}
