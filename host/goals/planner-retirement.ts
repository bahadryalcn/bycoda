import type { HostEngine } from "../engine";
import type { HostStore } from "../store";
import { cancelSessionRun, errorMessage, type SessionRunEngine } from "../sessions/sessionRuns";

/** Preserve only this already-started run when its reviewed goal loses admission.
 * Recovery bookkeeping never restores goal state or starts another provider. */
export async function retireReviewedPlanner(
  store: HostStore,
  engine: SessionRunEngine,
  waitForRun: HostEngine["waitForRun"] | undefined,
  goalId: string,
  started: { sessionId: string; runId: string },
  cause: unknown,
): Promise<never> {
  const key = `goal-planner-retirement:${goalId}:${started.runId}`;
  let persistedState: string | undefined;
  const record = async (state: string, cleanupError?: string) => {
    try {
      await store.db.runRecoveryBookkeeping(() =>
        store.db
          .prepare(
            "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(
            key,
            JSON.stringify({
              goalId,
              ...started,
              state,
              cause: errorMessage(cause),
              ...(cleanupError ? { cleanupError } : {}),
            }),
          ),
      );
      persistedState = state;
    } catch {
      // Storage failure cannot skip cancellation or erase the exact run from
      // the caller's uncertain outcome. No effects use bookkeeping authority.
    }
  };
  await record("cancellation-pending");
  let cancellation = "requested";
  try {
    await cancelSessionRun(engine, started);
    await record("cancellation-requested");
  } catch (error) {
    try {
      if (!waitForRun) throw error;
      await waitForRun(started.sessionId, started.runId);
      cancellation = "retired";
      await record("retired");
    } catch {
      cancellation = "unknown";
      await record("uncertain", errorMessage(error));
    }
  }
  throw new Error(
    `${errorMessage(cause)} Planner session ${started.sessionId}, run ${started.runId}; cancellation ${cancellation}; retirement receipt ${key}: ${persistedState ?? "not persisted"}. Inspect this exact run before recovery.`,
  );
}
