import type { HostStore } from "../../store";
import type { AssistantActivity } from "../../../src/shared/model/host-contracts/assistant";

/** Newest-first activity for one job, read straight from the activity rows (not the capped snapshot). */
export async function listAssistantJobActivity(
  db: Pick<HostStore["db"], "prepare">,
  jobId: string,
  limit = 100,
): Promise<AssistantActivity[]> {
  // shortcut: json_extract scans the activity table; add an index on jobId when history grows large.
  const rows = await db
    .prepare(
      "SELECT value FROM assistant_activity WHERE deleted_at IS NULL AND json_extract(value,'$.jobId')=? ORDER BY json_extract(value,'$.createdAt') DESC,id DESC LIMIT ?",
    )
    .all(jobId, limit);
  return rows.map((row) => JSON.parse(String(row.value)) as AssistantActivity);
}

export type JobStatusFailurePorts = {
  runtime<T>(id: string, fallback: T): Promise<T>;
  setRuntime(id: string, value: unknown): Promise<unknown>;
  activity(kind: string, summary: string, extra: { jobId: string }): Promise<AssistantActivity>;
};

/** Human-readable reason for a job status check that failed (not a scope hold). */
export function jobStatusFailureSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Job status check failed: ${message.replace(/\s+/g, " ").trim().slice(0, 900)}`;
}

/**
 * Records a job problem as activity once per distinct message. The last message is kept in
 * runtime, so a repeated tick with the same failure writes nothing.
 */
export async function recordJobProblemActivity(
  ports: JobStatusFailurePorts,
  jobId: string,
  summary: string,
): Promise<boolean> {
  const key = `jobProblem:${jobId}`;
  if ((await ports.runtime<string | null>(key, null)) === summary) return false;
  await ports.setRuntime(key, summary);
  await ports.activity("job.problem", summary, { jobId });
  return true;
}
