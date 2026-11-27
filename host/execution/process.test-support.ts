import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** An exited process can remain in the process table until its parent reaps it. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat[stat.lastIndexOf(")") + 2] !== "Z";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  if (process.platform === "darwin") {
    const state = spawnSync("/bin/ps", ["-o", "state=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (state.error) throw state.error;
    if (state.status === 1 && !state.stdout.trim()) return false;
    if (state.status !== 0) throw new Error("Could not inspect child process state.");
    return !state.stdout.trim().startsWith("Z");
  }
  return true;
}
