import { WS_LIMITS } from "../../../shared/model/host-contracts";

/** Reads of a restored project that a cold boot sends at once, before the SSH tunnel exists
 * (measured on 0.7.20: each was refused with SSH_CONNECTING). */
const COLD_ROUTE_METHODS = new Set(["sessions.list", "projects.list", "goals.list"]);

/** The measured startup `workspace.run` reads (0.7.20 Mac boot, then the second candidate on
 * Windows for `git_diff_stats`), and only those. This is deliberately not a
 * general read-only classification: any other command, every write and every unknown command
 * is sent once, when its caller asks, and is never held or replayed. */
const STARTUP_WORKSPACE_READS = new Set([
  "read_file_info",
  "read_text_file",
  "list_project_files",
  "list_dir",
  "git_history",
  "git_worktrees",
  "git_submodules",
  "git_file_diff",
  "git_diff_stats",
  "git_branches",
  "skill_policy_get",
]);

/**
 * Held cold reads start at most this many together per machine once discovery is done. The Host
 * admits `maxControlJobsPerDevice` control checks per device and answers the rest with
 * "Host read capacity is busy"; half of it leaves room for the pane the owner is using.
 */
export const COLD_ROUTE_READS_PER_MACHINE = Math.max(
  1,
  Math.floor(WS_LIMITS.maxControlJobsPerDevice / 2),
);

/** A held read keeps its slot at most this long, so one slow read cannot stall the others. */
export const COLD_ROUTE_SLOT_MS = 1_000;

/** An idempotent startup read that may wait for the first discovery of a cold SSH machine. */
export function isColdRouteRead(method: string, params: unknown): boolean {
  if (COLD_ROUTE_METHODS.has(method)) return true;
  if (method !== "workspace.run" || typeof params !== "object" || params === null) return false;
  const command = (params as { command?: unknown }).command;
  return typeof command === "string" && STARTUP_WORKSPACE_READS.has(command);
}

type Waiter = { start: () => void };
type Lane = { running: number; queue: Waiter[] };
const lanes = new Map<string, Lane>();

/** Runs `run` within the machine's cold-read budget; the rest wait in arrival order. */
export function runColdRouteRead<T>(machineId: string, run: () => Promise<T>): Promise<T> {
  let lane = lanes.get(machineId);
  if (!lane) lanes.set(machineId, (lane = { running: 0, queue: [] }));
  const owner = lane;
  return new Promise<T>((resolve, reject) => {
    owner.queue.push({
      start: () => {
        owner.running += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          clearTimeout(deadline);
          owner.running -= 1;
          drain(machineId, owner);
        };
        // A slow read must not hold the queue: its slot is lent out again after the slot deadline.
        const deadline = setTimeout(release, COLD_ROUTE_SLOT_MS);
        // A read that throws before it starts, or settles any way, frees its slot.
        void Promise.resolve().then(run).then(resolve, reject).finally(release);
      },
    });
    drain(machineId, owner);
  });
}

function drain(machineId: string, lane: Lane): void {
  while (lane.running < COLD_ROUTE_READS_PER_MACHINE && lane.queue.length)
    lane.queue.shift()!.start();
  if (!lane.running && !lane.queue.length && lanes.get(machineId) === lane) lanes.delete(machineId);
}

export function resetColdRouteReadsForTests(): void {
  lanes.clear();
}
