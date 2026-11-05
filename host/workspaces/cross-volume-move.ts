import { loadBundledGuardedMove } from "../host-notes-admission";
import { renameWithRetry } from "../storage/rename-retry";

/** The native worker owns quarantine, publication and recovery receipt. */
export async function crossVolumeMove(source: string, destination: string) {
  const move = loadBundledGuardedMove();
  return await move(source, destination);
}

/** Try the ordinary move once; only an exact EXDEV enters the guarded worker. */
export async function moveWithRecovery(
  source: string,
  destination: string,
  authorized?: () => Promise<boolean>,
) {
  if (authorized && !(await authorized())) throw new Error("Room file authority revoked.");
  try {
    // Transient Windows EPERM/EBUSY retry here; EXDEV is not retryable and still reaches the copy path.
    await renameWithRetry(source, destination);
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    if (authorized)
      throw new Error(
        "Cross-volume move is unavailable for revocable Room authority until publication can be reauthorized.",
      );
    return await crossVolumeMove(source, destination);
  }
}
