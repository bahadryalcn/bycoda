import { spawn, type ChildProcess } from "node:child_process";

export const TREE_KILL_DEADLINE_MS = 5_000;

/** Injectable edges so the platform branches are testable without live processes. */
export type TreePorts = {
  platform: NodeJS.Platform;
  spawn: typeof spawn;
  /** Signals the whole POSIX process group led by `pid`. */
  killGroup: (pid: number) => void;
};

const defaultPorts: TreePorts = {
  platform: process.platform,
  spawn,
  killGroup: (pid) => process.kill(-pid, "SIGKILL"),
};

/** POSIX hub children lead their own process group so the launcher's descendants can be reaped. */
export const hubChildLeadsGroup = (platform: NodeJS.Platform = process.platform): boolean =>
  platform !== "win32";

const running = (proc: ChildProcess) => proc.exitCode === null && proc.signalCode === null;

/** Kills the launcher and everything it started: `taskkill /T /F` on Windows (bounded by a
 * deadline), the child's own process group on POSIX. Only the tree rooted at this child is
 * addressed; a missing pid or a failed tree kill falls back to the direct child alone. */
export function killProcessTree(proc: ChildProcess, ports: TreePorts = defaultPorts): void {
  const pid = proc.pid;
  if (!pid) {
    proc.kill();
    return;
  }
  if (ports.platform !== "win32") {
    try {
      ports.killGroup(pid);
    } catch {
      proc.kill();
    }
    return;
  }
  const killer = ports.spawn("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const fallback = () => {
    if (running(proc)) proc.kill();
  };
  const deadline = setTimeout(() => {
    killer.kill();
    fallback();
  }, TREE_KILL_DEADLINE_MS);
  deadline.unref?.();
  killer.once("error", () => {
    clearTimeout(deadline);
    fallback();
  });
  killer.once("close", (code) => {
    clearTimeout(deadline);
    if (code !== 0) fallback();
  });
}

/** Called the moment the launcher exits: its group outlives it while any member runs, so
 * descendants it left behind are reaped. Windows has no group; its tree is gone with the
 * launcher's pid, which is why stop() kills the tree before the grace period ends. */
export function reapProcessGroup(proc: ChildProcess, ports: TreePorts = defaultPorts): void {
  if (!proc.pid || !hubChildLeadsGroup(ports.platform)) return;
  try {
    ports.killGroup(proc.pid);
  } catch {
    // No member is left in the group.
  }
}
