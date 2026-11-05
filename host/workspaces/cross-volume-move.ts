import { rename } from "node:fs/promises";
import { loadBundledGuardedMove } from "../host-notes-admission";

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
    await rename(source, destination);
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
