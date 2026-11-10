import { NO_VERIFICATION } from "./assistant-goal-verification";
import type {
  AssistantJobHoldReason,
  AssistantSnapshot,
} from "../../../src/shared/model/host-contracts/assistant";

type HoldInput = Pick<AssistantSnapshot, "jobs" | "profile" | "usage" | "paused"> & {
  workHoursActive: boolean;
  emergencyStop: boolean;
  canCreateGoal: boolean;
  /** Jobs the model pool currently refuses to run, by job id. */
  modelHolds?: Record<string, { held: "limits" | "noRow" }>;
  /** Job id to the job it must wait for. */
  dependencies?: Record<string, string>;
};

/** Why each queued project job is not starting; mirrors the dispatch gate in the job tick. */
export function assistantJobHolds(input: HoldInput): Record<string, AssistantJobHoldReason> {
  const { profile, usage } = input;
  const gate: AssistantJobHoldReason | null =
    !profile.enabled || !profile.setupComplete
      ? "disabled"
      : input.paused || input.emergencyStop
        ? "paused"
        : usage.mode !== "run"
          ? "budget"
          : profile.autonomy === "report"
            ? "report"
            : !input.workHoursActive
              ? "hours"
              : null;
  const holds: Record<string, AssistantJobHoldReason> = {};
  for (const job of input.jobs) {
    if (job.kind === "quick" || job.status !== "queued") continue;
    const held = input.modelHolds?.[job.id]?.held;
    const reason =
      gate ??
      (input.dependencies?.[job.id] &&
      input.jobs.find((item) => item.id === input.dependencies?.[job.id])?.status !== "done"
        ? "dependency"
        : null) ??
      (held === "limits" ? "limits" : held === "noRow" ? "noModel" : null) ??
      (!profile.execution || !input.canCreateGoal ? "noExecution" : null);
    if (reason) holds[job.id] = reason;
  }
  return holds;
}

/** Adds job holds to a snapshot. */
export function withJobHolds(
  snapshot: AssistantSnapshot,
  gate: {
    emergencyStop: boolean;
    canCreateGoal: boolean;
    modelHolds?: HoldInput["modelHolds"];
    dependencies?: HoldInput["dependencies"];
  },
): AssistantSnapshot {
  return {
    ...snapshot,
    jobHolds: assistantJobHolds({
      ...snapshot,
      workHoursActive: snapshot.workHoursActive ?? true,
      ...gate,
    }),
  };
}

/** Kinds that reach the owner even when the presence setting only allows urgent ones; quiet hours and do-not-disturb still defer them. */
export const assistantNotificationUrgent = (kind: string) =>
  ["budget.exhausted", "job.failed", "job.stalled", "task.needsInput", "reminder"].includes(kind);

const WAITING: Record<string, string> = {
  planApproval: "Plan approval needed.",
  owner: "Needs your input.",
  error: "Stopped with an error.",
  limits: "Waiting for a model limit to reset.",
};

/** Notification text for a job that just moved to waiting or stalled. */
export function assistantJobNotificationBody(
  status: string,
  summary: string,
  waitingReason: "error" | "planApproval" | "owner" | "limits" | undefined,
  stallMinutes: number,
  verification?: string,
): string {
  if (status === "stalled")
    return `No output for ${stallMinutes} minutes.${summary ? ` ${summary}` : ""}`;
  if (status === "waiting" && waitingReason) {
    if (waitingReason === "error" && summary) return `Stopped with an error: ${summary}`;
    return summary && waitingReason === "owner"
      ? `${WAITING.owner} ${summary}`
      : WAITING[waitingReason];
  }
  if (status === "done") return `${summary || "Job is done."} ${verification ?? NO_VERIFICATION}`;
  return summary || `Job is ${status}.`;
}
