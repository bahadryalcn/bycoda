import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";
import { isoTimestamp } from "../../../src/shared/lib/time/timestamps";
import { AssistantModelsHeldError } from "../models/assistant-model-execution";

export type AssistantModelHold = {
  held: "limits" | "noRow";
  nextResetAt?: number;
  reason?: "noEligibleEntry";
  at: number;
};
type Choice = { rowId: string; model: string; providerAccountId?: string; reason: string };
export type AssistantGoalSubmission = { goalId: string; modelChoice?: Choice };

export const modelHoldKey = (jobId: string) => `modelHold:${jobId}`;

/** Stored model holds by job id, read from the runtime rows the job tick writes. */
export async function loadModelHolds(db: {
  prepare(sql: string): {
    all(): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
  };
}): Promise<Record<string, AssistantModelHold>> {
  const rows = await db
    .prepare(
      "SELECT id,value FROM assistant_runtime WHERE id LIKE 'modelHold:%' AND deleted_at IS NULL AND json_extract(value,'$.value.held') IS NOT NULL LIMIT 1000",
    )
    .all();
  const holds: Record<string, AssistantModelHold> = {};
  for (const row of rows) {
    const value = (JSON.parse(String(row.value)) as { value?: AssistantModelHold }).value;
    if (value) holds[String(row.id).slice("modelHold:".length)] = value;
  }
  return holds;
}

/** Runtime row for a job held by the model pool. */
export function modelHoldRecord(error: AssistantModelsHeldError, at: number): AssistantModelHold {
  return {
    held: error.held,
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.nextResetAt === undefined ? {} : { nextResetAt: error.nextResetAt }),
    at,
  };
}

/** One notification per job per reset window; the id carries the window. */
export function modelHoldNotification(
  job: { id: string; title: string; projectId?: string },
  hold: AssistantModelHold,
) {
  return {
    id: `model-hold:${job.id}:${hold.nextResetAt ?? "none"}`,
    kind: "job.waiting" as const,
    title: job.title,
    body:
      hold.reason === "noEligibleEntry"
        ? "No eligible model is available for this job. Work is queued and will retry. Check Settings > Models."
        : hold.held === "limits"
          ? isoTimestamp(hold.nextResetAt) === undefined
            ? "All models in the pool are at their limit."
            : `All models in the pool are at their limit until ${isoTimestamp(hold.nextResetAt)}.`
          : "No model in the pool can run this job.",
  };
}

export const goalSubmittedText = (goal: AssistantGoalSubmission) =>
  `The job was submitted to the goal planner.${modelChoiceText(goal.modelChoice)}`;

/** Appended to the start activity so the owner sees which model the job got. */
function modelChoiceText(choice: Choice | undefined): string {
  if (!choice) return "";
  const account = choice.providerAccountId ?? "default";
  const skipped = choice.reason.startsWith("skipped:")
    ? choice.reason.slice(8).split(",").filter(Boolean).length
    : 0;
  return ` Using ${choice.model} (account ${account}): ${
    skipped ? `skipped ${skipped} rows below their limit` : "first available"
  }`;
}

/** Returns a job the pool refused to `queued`, records the hold and queues one notice per window. */
export async function holdJobForModels(input: {
  store: { transaction<T>(work: () => Promise<T>, mode: "critical"): Promise<T> };
  repository: { put(table: "jobs", value: never, version?: number): Promise<unknown> };
  setRuntime(id: string, value: unknown): Promise<unknown>;
  queueNotification(value: never): Promise<unknown>;
  now: number;
  job: { id: string; title: string; version: number };
  original: { dispatchState?: unknown; updatedAt: number };
  error: AssistantModelsHeldError;
}) {
  const { job, original } = input;
  const hold = modelHoldRecord(input.error, input.now);
  await input.store.transaction(async () => {
    await input.repository.put(
      "jobs",
      {
        ...job,
        status: "queued",
        dispatchState: original.dispatchState,
        updatedAt: original.updatedAt,
      } as never,
      job.version,
    );
    await input.setRuntime(modelHoldKey(job.id), hold);
    await input.queueNotification({
      ...modelHoldNotification(job, hold),
      createdAt: input.now,
      jobId: job.id,
      projectIds: assistantJobProjectIds(job as never),
    } as never);
  }, "critical");
}

/** A failed planner submission: a model-pool hold re-queues the job; anything else is unknown. */
export async function handleJobSubmitFailure(
  input: Omit<Parameters<typeof holdJobForModels>[0], "error"> & {
    error: unknown;
    activity(kind: string, text: string, extra: { jobId: string }): Promise<unknown>;
  },
) {
  const { error, job, now } = input;
  if (error instanceof AssistantModelsHeldError) return holdJobForModels({ ...input, error });
  // The effect might have committed before transport/storage failed.
  // Keep its stable identity and reconcile it via findGoal on next tick.
  await input.store.transaction(async () => {
    await input.repository.put(
      "jobs",
      {
        ...job,
        status: "waiting",
        summary: `Planner submission outcome is unknown. ${String(error).slice(0, 1000)}`,
        updatedAt: now,
      } as never,
      job.version,
    );
    await input.activity("job.unknown", "Planner submission needs reconciliation.", {
      jobId: job.id,
    });
  }, "critical");
}
