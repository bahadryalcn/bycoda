import type { WorkRecord, WorkWait } from "../../src/shared/model/host-contracts/work";
import type { HostLimits } from "../limits";
import type { WorkCallbacks } from "./contracts";
import type { WorkStorage } from "./storage";

export type WorkHostLimits = Pick<HostLimits, "settings" | "reached">;

/** Admission holds the SQL owner until its reservation commits, before awaited preparation. */
export async function reserveWork(
  storage: WorkStorage,
  limits: WorkHostLimits,
  callbacks: WorkCallbacks,
  id: string,
): Promise<{ work: WorkRecord; claimed: boolean }> {
  await storage.ready;
  return storage.store.transaction(async () => {
    const work = await storage.get(id);
    if (work.reserved || work.stopRequested || work.state === "completed")
      return { work, claimed: false };
    const wait = async (reason: WorkWait) => ({
      work: await storage.save({ ...work, state: "waiting", wait: reason }),
      claimed: false,
    });
    if (await limits.reached())
      return wait({ code: "dailyLimit", message: "Daily agent time limit reached." });
    const { maxRunningTasks } = await limits.settings();
    const active = (await storage.list()).filter((item) => item.reserved);
    const known = new Set(
      active.flatMap((item) =>
        item.receipt ? [JSON.stringify([item.receipt.sessionId, item.receipt.runId])] : [],
      ),
    );
    const external = (await callbacks.externalRunning()).filter(
      (run) => !known.has(JSON.stringify([run.sessionId, run.runId])),
    );
    // Deduplicate external sources that observe the same physical turn.
    const uniqueExternal = [
      ...new Map(
        external.map((run) => [JSON.stringify([run.sessionId, run.runId]), run] as const),
      ).values(),
    ];
    if (active.length + uniqueExternal.length >= maxRunningTasks) {
      return wait({ code: "capacity", message: "Waiting for a free work slot." });
    }
    if (work.projectId && callbacks.projectConcurrency) {
      const limit = await callbacks.projectConcurrency(work.projectId);
      if (limit !== undefined) {
        if (!Number.isSafeInteger(limit) || limit < 1)
          throw new Error("Invalid project work concurrency.");
        const used =
          active.filter((item) => item.projectId === work.projectId).length +
          uniqueExternal.filter((run) => run.projectId === work.projectId).length;
        if (used >= limit)
          return wait({
            code: "projectCapacity",
            message: "Waiting for a free project work slot.",
          });
      }
    }
    return {
      work: await storage.save({ ...work, state: "unknown", reserved: true, wait: undefined }),
      claimed: true,
    };
  }, "critical");
}
