import { failedMachineNames, staleMachineNames } from "../../automations/model/machineResults";
import { isProjectLocked } from "../../group-lock/model/groupLock";
import { listBoardGoalResults, goalMachines } from "./goalClient";
import { buildDailySummary, type DailySummary, type SummaryUsage } from "./dailySummary";
import { listMachineLimits, settingsMachines } from "./settingsClient";
import { listBoardTaskResults, probeTaskMachines } from "./taskClient";

const KEY = "bycoda.tasks.dailySummary.v1";
export const DAILY_SUMMARY_STORED_EVENT = "bycoda:daily-summary-stored";
/** Raised when a notification click asks the open Tasks view to show it. */
export const DAILY_SUMMARY_OPEN_EVENT = "bycoda:daily-summary-open";

let openRequested = false;

/** Asks the Tasks view to open its summary panel, now or once it mounts. */
export function requestSummaryPanel() {
  openRequested = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DAILY_SUMMARY_OPEN_EVENT));
}

/** True once per request. */
export function takeSummaryPanelRequest(): boolean {
  const requested = openRequested;
  openRequested = false;
  return requested;
}

/** One pass over every machine: tasks, goals and today's agent time. A
 * machine that cannot be reached is listed in the summary, never fatal. */
export async function gatherDailySummary(since: number, now = Date.now()): Promise<DailySummary> {
  const [reach, goalHosts, limitHosts] = await Promise.all([
    probeTaskMachines(),
    goalMachines(),
    settingsMachines(),
  ]);
  const down = reach.unreachableMachines;
  const [taskResults, goalResults, limits] = await Promise.all([
    listBoardTaskResults(reach.capable, down),
    listBoardGoalResults(goalHosts, down),
    listMachineLimits(
      limitHosts.filter((machine) => !down.some((entry) => entry.id === machine.id)),
    ),
  ]);
  const results = [...taskResults, ...goalResults];
  // A stale list is the last answer of a machine that has gone quiet.
  const unreachable = [
    ...new Set([
      ...reach.unreachable,
      ...failedMachineNames(results),
      ...staleMachineNames(results),
    ]),
  ];
  const usageByMachine: SummaryUsage[] = limits.map((entry) => ({
    machineName: entry.machineName,
    usedMinutes: entry.usedMinutes,
    dailyAgentMinutes: entry.dailyAgentMinutes,
  }));
  return buildDailySummary({
    since,
    now,
    tasks: taskResults
      .flatMap((result) => result.data)
      .filter((task) => !isProjectLocked(task.cwd)),
    goals: goalResults
      .flatMap((result) => result.data)
      .filter((goal) => !goal.projects.some((project) => isProjectLocked(project.cwd))),
    usageByMachine,
    unreachable,
    outdated: reach.outdated,
  });
}

export function loadStoredDailySummary(): DailySummary | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const summary = parsed as Partial<DailySummary>;
    return typeof summary.until === "number" &&
      Array.isArray(summary.finished) &&
      Array.isArray(summary.blocked) &&
      Array.isArray(summary.waiting) &&
      Array.isArray(summary.suggestions) &&
      Array.isArray(summary.goals) &&
      Array.isArray(summary.goalsFinished) &&
      Array.isArray(summary.usage) &&
      Array.isArray(summary.unreachable) &&
      Array.isArray(summary.outdated)
      ? (summary as DailySummary)
      : null;
  } catch {
    return null;
  }
}

export function saveStoredDailySummary(summary: DailySummary) {
  try {
    localStorage.setItem(KEY, JSON.stringify(summary));
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DAILY_SUMMARY_STORED_EVENT));
}
