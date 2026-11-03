import type { AssistantSessionManagement, SessionMessageAuthor } from "./session";

const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
export function assistantSessionManagement(value: unknown): AssistantSessionManagement | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (
    row.assistant !== true ||
    (row.jobId !== undefined) === (row.supervisionId !== undefined) ||
    bounded(row.jobId, 200) === bounded(row.supervisionId, 200) ||
    !Number.isSafeInteger(row.managedAt) ||
    (row.managedAt as number) < 0
  )
    return;
  return {
    assistant: true,
    managedAt: row.managedAt as number,
    ...(bounded(row.jobId, 200)
      ? { jobId: row.jobId }
      : { supervisionId: row.supervisionId as string }),
  };
}
/** Validates display provenance only. This does not establish an execution grant. */
export function sessionMessageAuthor(value: unknown): SessionMessageAuthor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (!bounded(row.name, 200) || !bounded(row.reason, 200)) return;
  if (row.kind === "assistant-manual") {
    if (
      !bounded(row.supervisionId, 200) ||
      row.jobId !== undefined ||
      !bounded(row.operationId, 1000) ||
      !["nudge", "answer", "steer", "kickoff"].includes(row.reason) ||
      (row.activityId !== undefined && !bounded(row.activityId, 200))
    )
      return;
    return {
      kind: "assistant-manual",
      name: row.name,
      supervisionId: row.supervisionId,
      reason: row.reason as "nudge" | "answer" | "steer" | "kickoff",
      operationId: row.operationId,
      ...(row.activityId ? { activityId: row.activityId as string } : {}),
    };
  }
  if (row.kind === "assistant") {
    if (
      !bounded(row.jobId, 200) ||
      row.supervisionId !== undefined ||
      !bounded(row.operationId, 1000) ||
      !["nudge", "answer", "steer", "kickoff"].includes(row.reason)
    )
      return;
    if (row.activityId !== undefined && !bounded(row.activityId, 200)) return;
    return {
      kind: "assistant",
      name: row.name,
      jobId: row.jobId,
      reason: row.reason as "nudge" | "answer" | "steer" | "kickoff",
      operationId: row.operationId,
      ...(row.activityId ? { activityId: row.activityId as string } : {}),
    };
  }
  if (
    (row.kind === "task" || row.kind === "automation" || row.kind === "steward") &&
    bounded(row.id, 200)
  ) {
    if (row.operationId !== undefined && !bounded(row.operationId, 1000)) return;
    return {
      kind: row.kind,
      id: row.id,
      name: row.name,
      reason: row.reason,
      ...(row.operationId ? { operationId: row.operationId as string } : {}),
    };
  }
}
