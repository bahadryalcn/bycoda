import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantRepository, RecordValue } from "../repository";

export const JOBS_STALL_NUDGE =
  "You appear to have made no progress for a while. Please continue the task, or say what is blocking you.";
const MAX_SESSIONS_PER_TICK = 3;

type Marker = RecordValue & { value: { at: number } };
export interface JobsStallDeps {
  repository: AssistantRepository;
  now(): number;
  /** The managed-session port; late-bound because the Host wires it after construction. */
  ports: {
    manageSession?(input: {
      jobId: string;
      sessionId: string;
      requestId: string;
      text: string;
      reason: "nudge";
    }): Promise<unknown>;
  };
  activity(
    kind: string,
    summary: string,
    extra: { jobId: string; sessionId: string },
  ): Promise<unknown>;
  onError?(error: unknown): void;
}

/** Autonomy levels allowed to nudge or restart a stalled assistant job worker. */
export const stallRecoveryAutonomy = (profile: Pick<AssistantProfile, "autonomy">, jobs: boolean) =>
  profile.autonomy === "chief" || (jobs && profile.autonomy === "jobs");

/**
 * Jobs mode has no Chief to nudge, so a stalled job worker gets one fixed follow-up per stall.
 * The managed-session layer still enforces the nudge limit; the next nudge past it is the
 * existing once-per-task worker restart. Only the job's own sessions are touched.
 */
export async function nudgeStalledJobSessions(
  deps: JobsStallDeps,
  job: { id: string },
  sessionIds: readonly string[],
  profile: Pick<AssistantProfile, "autonomy" | "stallMinutes">,
): Promise<void> {
  if (profile.autonomy !== "jobs" || !deps.ports.manageSession) return;
  const store = deps.repository.store;
  let sent = 0;
  for (const sessionId of sessionIds) {
    if (sent >= MAX_SESSIONS_PER_TICK) return;
    try {
      const record = await store.session(sessionId),
        activity = record.runActivity;
      if (
        record.status !== "running" ||
        !activity ||
        activity.runId !== record.runId ||
        deps.now() - activity.lastActivityAt < profile.stallMinutes * 60000
      )
        continue;
      // One stall is one (session, run, last activity); a later stall has a new activity time.
      const requestId = `jobs-stall-${activity.runId}-${activity.lastActivityAt}`,
        key = `jobStallNudge:${job.id}:${sessionId}:${requestId}`;
      if (await deps.repository.get("runtime", key)) continue;
      const now = deps.now();
      await store.transaction(
        () =>
          deps.repository.put<Marker>("runtime", {
            id: key,
            version: 0,
            createdAt: now,
            updatedAt: now,
            value: { at: now },
          }),
        "critical",
      );
      sent++;
      try {
        const recovery = (await deps.ports.manageSession({
          jobId: job.id,
          sessionId,
          requestId,
          text: JOBS_STALL_NUDGE,
          reason: "nudge",
        })) as { state?: string; message?: string } | undefined;
        await deps.activity(
          recovery?.state ? "session.recovered" : "session.nudged",
          recovery?.message ?? "A stalled worker was nudged once.",
          { jobId: job.id, sessionId },
        );
      } catch (error) {
        await deps.activity(
          "session.nudgeFailed",
          `Stall follow-up was not delivered: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`,
          { jobId: job.id, sessionId },
        );
      }
    } catch (error) {
      deps.onError?.(error);
    }
  }
}
