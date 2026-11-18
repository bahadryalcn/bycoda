import { join } from "node:path";
import { probeHostOwner } from "./owner";
import { readStateFileSync } from "./storage/atomic-write";

export type RunningHost = { pid: number; port: number; secret: string };

/** Total time a stopping Host may spend draining before it force-exits. */
export const HOST_SHUTDOWN_DEADLINE_MS = 45_000;

/** How long a stopping caller waits for the Host to exit. It outlasts the Host's
 * own forced exit: a drain stuck on an open request still ends by that deadline,
 * and giving up earlier failed every upgrade while the old Host was still leaving. */
export const HOST_STOP_WAIT_MS = HOST_SHUTDOWN_DEADLINE_MS + 15_000;

/** Retain corrupt metadata: removing it could hide an owner from another CLI reader. */
export function readRunningHost(directory: string): RunningHost | undefined {
  const result = readStateFileSync(
    join(directory, "running.json"),
    (text): RunningHost => {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object") throw new Error("Invalid Host lifecycle state");
      const state = value as RunningHost;
      if (
        !Number.isSafeInteger(state.pid) ||
        state.pid < 1 ||
        !Number.isSafeInteger(state.port) ||
        state.port < 1 ||
        state.port > 65_535 ||
        typeof state.secret !== "string" ||
        !state.secret
      )
        throw new Error("Invalid Host lifecycle state");
      return state;
    },
    { quarantine: false },
  );
  return result.value;
}

/** An unreachable endpoint or missing lifecycle file is not proof that work stopped. */
export async function verifyHostStopped(directory: string): Promise<void> {
  const owner = await probeHostOwner(directory);
  if (owner !== "stopped")
    throw new Error(
      owner === "active"
        ? "Host still owns its data directory, but lifecycle state is unavailable or unreachable; stop was not confirmed"
        : "Host status is unknown; lifecycle state or process ownership could not be verified",
    );
}
