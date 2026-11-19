import { invoke } from "@tauri-apps/api/core";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";

/** First wait before completion is offered again after the native owner answered "held". */
export const COMPLETE_RETRY_BASE_MS = 250;
/** The wait doubles up to this. */
export const COMPLETE_RETRY_MAX_MS = 2_000;
/** Total time one completion may keep retrying; after it the cycle is reported unconfirmed. */
export const COMPLETE_DEADLINE_MS = 30_000;

/** The wait after `attempt` refused completions (0-based): 250 ms, 500 ms, 1 s, then 2 s. */
export const completeRetryDelay = (attempt: number): number =>
  Math.min(COMPLETE_RETRY_BASE_MS * 2 ** Math.max(0, attempt), COMPLETE_RETRY_MAX_MS);

/** Refusals that clear once in-flight native effects end or another window lets go. */
function isOwnerBusy(error: unknown): boolean {
  const message = String(error);
  return message.includes("SYNC_OWNER_HELD") || message.includes("NATIVE_CONTROL_WINDOW_BUSY");
}

/** Resolves after `ms`, or at once when `signal` aborts; never leaves a timer or listener behind. */
function waitOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Releases the native owner's hold on one sync cycle. While the owner still reports the cycle
 * held, completion is retried with backoff until `COMPLETE_DEADLINE_MS` or until `signal` aborts
 * (the loop stopping). Either way it then throws, which the loop records as an unconfirmed
 * completion: the cycle stays unresolved, so window ownership is not released and the machine
 * backs off. Any other refusal throws at once.
 */
export async function completeNativeSyncCycle(
  machineId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<void> {
  const startedAt = monotonicNow();
  for (let attempt = 0; ; attempt += 1) {
    try {
      await invoke<void>("sync_cycle_complete", { machineId, operationId });
      return;
    } catch (error) {
      if (!isOwnerBusy(error)) throw error;
      const wait = completeRetryDelay(attempt);
      if (signal?.aborted)
        throw new Error(`Sync completion stopped while the owner still holds the cycle: ${error}`);
      if (elapsedSince(startedAt) + wait > COMPLETE_DEADLINE_MS)
        throw new Error(
          `Sync completion timed out while the owner still holds the cycle: ${error}`,
        );
      await waitOrAbort(wait, signal);
      if (signal?.aborted)
        throw new Error(`Sync completion stopped while the owner still holds the cycle: ${error}`);
    }
  }
}
