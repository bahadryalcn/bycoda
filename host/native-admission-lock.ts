import { open, unlink } from "node:fs/promises";
import { elapsedSince, monotonicNow } from "../src/shared/lib/time/timestamps";

/** Shared by the Host effect owner and the explicit local provisioning CLI. */
export async function acquireNativeAdmissionLock(
  path: string,
  timeoutMs = 5000,
): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const started = monotonicNow();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await handle.close();
        } finally {
          await unlink(lockPath);
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (elapsedSince(started) >= timeoutMs) throw new Error("Native admission registry is busy.");
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(25, Math.max(1, timeoutMs - elapsedSince(started)))),
      );
    }
  }
}
