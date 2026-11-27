import { t } from "../../../shared/i18n";
import type { HostGoal } from "../../tasks/model/hostGoals";
import {
  ASSISTANT_PRESENCE_FRESH_MS,
  type AssistantJob,
  type AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import { readAssistantSession } from "./assistantSessions";
import { assistantJobProjectIds } from "./assistantJobs";
import { sameAssistantProjectSet } from "../../../shared/model/assistantProjects";
import { captureAssistantHostRead, type AssistantHostRead } from "./assistantHostRead";

type ApprovalSource = { environmentId: string; projectId: string; jobId: string; title: string };
export type AssistantGoalApprovalTarget = ApprovalSource & {
  kind: "goal";
  goalId: string;
  projectIds?: string[];
  updatedAt: number;
  planIdentity: string;
};
export type AssistantSessionApprovalTarget = ApprovalSource & {
  kind: "session";
  sessionId: string;
  blockId: string;
  requestId: number;
  occurrenceId?: string;
  runId: string;
  authorityGeneration?: number;
};
export type AssistantApprovalTarget = AssistantGoalApprovalTarget | AssistantSessionApprovalTarget;

async function goals(owner: AssistantHostRead) {
  const result = await owner.goals();
  if (!Array.isArray(result)) throw new Error(t("The Host returned no epic list."));
  return result;
}
function goalTarget(
  goal: HostGoal,
  job: AssistantJob,
  environmentId: string,
): AssistantGoalApprovalTarget | undefined {
  if (job.kind === "quick") return;
  if (
    goal.id !== job.goalId ||
    goal.id !== `assistant-${job.id}` ||
    goal.status !== "awaiting-approval" ||
    !goal.plan ||
    !sameAssistantProjectSet(goal.projectIds, assistantJobProjectIds(job)) ||
    !Number.isFinite(goal.updatedAt)
  )
    return;
  return {
    kind: "goal",
    environmentId,
    projectId: job.projectId,
    projectIds: assistantJobProjectIds(job),
    jobId: job.id,
    title: job.title,
    goalId: goal.id,
    updatedAt: goal.updatedAt,
    planIdentity: JSON.stringify(goal.plan),
  };
}
async function sessionTarget(
  sessionId: string,
  job: AssistantJob,
  owner: AssistantHostRead,
): Promise<AssistantSessionApprovalTarget | undefined> {
  if (job.kind === "quick") return;
  const record = await readAssistantSession(sessionId, assistantJobProjectIds(job), owner);
  const block = record.session.blocks.find((entry) => entry.approval && !entry.approval.decided);
  if (!block?.approval) return;
  if (
    record.status !== "running" ||
    !record.runId ||
    !Number.isSafeInteger(block.approval.requestId)
  )
    throw new Error(t("The pending approval has no current execution identity."));
  return {
    kind: "session",
    environmentId: owner.environmentId,
    projectId: record.projectId,
    jobId: job.id,
    title: job.title,
    sessionId,
    blockId: block.id,
    requestId: block.approval.requestId,
    ...(block.approval.occurrenceId ? { occurrenceId: block.approval.occurrenceId } : {}),
    runId: record.runId,
    ...(record.authorityGeneration === undefined
      ? {}
      : { authorityGeneration: record.authorityGeneration }),
  };
}

/** Owner navigation reads actual pending sources. A waiting job label is never
 * substituted for a provider approval or the first conversation in its list. */
export async function findAssistantApprovals(
  jobs: readonly AssistantJob[],
  captured?: AssistantHostRead,
) {
  const owner = captured ?? (await captureAssistantHostRead()),
    environmentId = owner.environmentId;
  const owned = jobs.filter(
    (job) =>
      job.kind !== "quick" &&
      job.goalId === `assistant-${job.id}` &&
      !["cancelled", "done"].includes(job.status),
  );
  const targets: AssistantApprovalTarget[] = [];
  let unavailable = 0;
  try {
    for (const goal of await goals(owner)) {
      const job = owned.find((job) => job.goalId === goal.id);
      if (job) {
        const target = goalTarget(goal, job, environmentId);
        if (target) targets.push(target);
      }
    }
  } catch {
    unavailable++;
  }
  const seen = new Set<string>();
  const reads = owned.flatMap((job) =>
    job.sessionIds
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => ({ id, job })),
  );
  // Keep the metadata lane bounded for large retained job histories.
  for (let index = 0; index < reads.length; index += 4) {
    const batch = await Promise.allSettled(
      reads.slice(index, index + 4).map(({ id, job }) => sessionTarget(id, job, owner)),
    );
    for (const result of batch)
      if (result.status === "fulfilled") {
        if (result.value) targets.push(result.value);
      } else unavailable++;
  }
  return { targets, unavailable };
}

export async function verifyAssistantApproval(
  target: AssistantApprovalTarget,
  jobs: readonly AssistantJob[],
  captured?: AssistantHostRead,
) {
  const owner = captured ?? (await captureAssistantHostRead(target.environmentId));
  if (owner.environmentId !== target.environmentId)
    throw new Error(t("The approval's Host changed. Check again."));
  const job = jobs.find(
    (job) =>
      job.kind !== "quick" &&
      job.id === target.jobId &&
      (target.kind === "goal"
        ? job.projectId === target.projectId
        : assistantJobProjectIds(job).includes(target.projectId)) &&
      job.goalId === `assistant-${job.id}`,
  );
  if (!job || ["cancelled", "done"].includes(job.status))
    throw new Error(t("The linked job changed. Check approvals again."));
  if (target.kind === "goal") {
    if (
      !sameAssistantProjectSet(target.projectIds ?? [target.projectId], assistantJobProjectIds(job))
    )
      throw new Error(t("The linked job changed. Check approvals again."));
    const current = (await goals(owner)).find((goal) => goal.id === target.goalId);
    const next = current ? goalTarget(current, job, target.environmentId) : undefined;
    if (!next || next.updatedAt !== target.updatedAt || next.planIdentity !== target.planIdentity)
      throw new Error(t("The pending plan changed. Check approvals again."));
  } else {
    if (!job.sessionIds.includes(target.sessionId))
      throw new Error(t("The approval no longer belongs to this job."));
    const next = await sessionTarget(target.sessionId, job, owner);
    if (
      !next ||
      next.projectId !== target.projectId ||
      next.blockId !== target.blockId ||
      next.requestId !== target.requestId ||
      next.occurrenceId !== target.occurrenceId ||
      next.runId !== target.runId ||
      next.authorityGeneration !== target.authorityGeneration
    )
      throw new Error(t("The pending approval changed. Check again."));
  }
}

export function assistantPresenceState(
  snapshot: Pick<AssistantSnapshot, "presence" | "automaticPresence" | "effectivePresence">,
  now: number,
) {
  const automatic = snapshot.automaticPresence;
  const fresh =
    !!automatic?.supported &&
    automatic.updatedAt <= now &&
    now - automatic.updatedAt <= ASSISTANT_PRESENCE_FRESH_MS;
  // A computer without a current reading is away: availability is never unknown.
  const detected = fresh ? automatic.state : "away";
  const effective =
    snapshot.presence.state !== "present"
      ? snapshot.presence.state
      : (snapshot.effectivePresence ?? (detected === "locked" ? "away" : detected));
  return { detected, effective, automaticUpdatedAt: fresh ? automatic?.updatedAt : undefined };
}

/**
 * Milliseconds until the automatic reading's freshness changes (#315): it becomes fresh at its
 * own timestamp and stale `ASSISTANT_PRESENCE_FRESH_MS` later. `undefined` when no boundary is
 * ahead, so an idle chip needs no timer at all.
 */
export function assistantPresenceRecheckDelay(
  automatic: AssistantSnapshot["automaticPresence"],
  now: number,
) {
  if (!automatic?.supported) return undefined;
  if (automatic.updatedAt > now) return automatic.updatedAt - now;
  const staleIn = automatic.updatedAt + ASSISTANT_PRESENCE_FRESH_MS - now;
  return staleIn >= 0 ? staleIn + 1 : undefined;
}

/** Milliseconds from `now` to the next local `HH:MM` (today if still ahead, otherwise tomorrow). */
export function msUntilClockTime(time: string, now: Date) {
  const target = new Date(now);
  target.setHours(Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}
