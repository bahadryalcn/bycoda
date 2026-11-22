import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

export type HostMode = "app" | "service";

export async function readLifecycleMode(directory: string) {
  const state = await readStateFile(
    join(directory, "lifecycle.json"),
    (text) => {
      const value = JSON.parse(text);
      if (value?.version !== 1 || (value.mode !== "app" && value.mode !== "service"))
        throw new Error("Invalid Host lifecycle mode");
      return value.mode as HostMode;
    },
    { quarantine: false },
  );
  if (state.status === "corrupt") throw state.error;
  if (state.status === "ok") return { mode: state.value, persisted: true };
  const installed = await stat(join(directory, "runtime-path")).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  return { mode: installed ? ("service" as const) : ("app" as const), persisted: false };
}

export async function commitServiceMode(
  directory: string,
  mode: HostMode,
  registered: () => Promise<boolean>,
): Promise<void> {
  if ((await registered()) !== (mode === "service"))
    throw new Error("The service manager did not confirm the requested Host lifecycle mode.");
  await writeFileAtomic(join(directory, "lifecycle.json"), JSON.stringify({ version: 1, mode }), {
    mode: 0o600,
  });
}

export function hostParentAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function watchHostParent(
  pid: number,
  stop: (reason: string) => void,
  alive = hostParentAlive,
): void {
  const poll = () => {
    if (alive(pid)) return;
    clearInterval(timer);
    stop("parent-exit");
  };
  const timer = setInterval(poll, 1_000);
  timer.unref();
  poll();
}
