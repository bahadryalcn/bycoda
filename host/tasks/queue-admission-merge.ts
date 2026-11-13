import { parseHostTask } from "./routing-input";
import { isDeepStrictEqual } from "node:util";
import { assertExpectedConfiguration } from "../configurationConflict";
import { type HostTask } from "../../src/features/tasks/model/hostTasks";

/** Apply only the prepared transition, preserving unrelated concurrent updates. */
export function mergeQueueAdmission(
  prepared: HostTask,
  original: HostTask,
  current?: HostTask,
): HostTask {
  if (!current || current.status !== original.status)
    throw new Error("Task changed before queue admission. Read it again.");
  try {
    assertExpectedConfiguration({ expectedConfiguration: original }, current, parseHostTask);
  } catch {
    throw new Error("Task changed before queue admission. Read it again.");
  }
  const before = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  const after = JSON.parse(JSON.stringify(prepared)) as Record<string, unknown>;
  const latest = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  for (const key of [
    "sessionId",
    "runId",
    "branch",
    "worktreeCwd",
    "workspaceId",
    "workspaceGenerationId",
    "artifactDeliveryPending",
    "artifactDeliveryActivityId",
    "merged",
    "crewRunId",
    "needsInput",
    "repairStop",
    "blockedTakeover",
    "awaitingOwnerRestart",
    "deliveryRequested",
  ]) {
    if (!isDeepStrictEqual(before[key], latest[key]))
      throw new Error("Task changed before queue admission. Read it again.");
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    if (key !== "updatedAt" && !isDeepStrictEqual(before[key], latest[key]))
      throw new Error("Task changed before queue admission. Read it again.");
    if (key in after) latest[key] = after[key];
    else delete latest[key];
  }
  return latest as HostTask;
}
