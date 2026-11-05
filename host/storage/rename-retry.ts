import { lstatSync, renameSync, type Stats } from "node:fs";
import { lstat, rename } from "node:fs/promises";

// Retry only while both entries still match the pre-publication observation.
// This avoids repeating a rename whose outcome or target has changed.
function signature(stat: Stats | undefined): string {
  return stat ? [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":") : "missing";
}
function retryable(error: unknown): boolean {
  return process.platform === "win32" && ["EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "");
}
async function identity(path: string): Promise<string> {
  try { return signature(await lstat(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}
function identitySync(path: string): string {
  try { return signature(lstatSync(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}
export async function renameWithRetry(from: string, to: string): Promise<void> {
  const source = await identity(from), target = await identity(to);
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      if (attempt >= 4 || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      if (source === "missing" || await identity(from) !== source || await identity(to) !== target) throw error;
    }
  }
}
export function renameWithRetrySync(from: string, to: string): void {
  const source = identitySync(from), target = identitySync(to);
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return; }
    catch (error) {
      if (attempt >= 4 || !retryable(error)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
      if (source === "missing" || identitySync(from) !== source || identitySync(to) !== target) throw error;
    }
  }
}
