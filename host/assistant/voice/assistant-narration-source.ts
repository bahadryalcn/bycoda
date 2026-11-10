import type { NarrationEvent } from "./assistant-narration";
import type {
  AssistantActivity,
  AssistantJob,
  AssistantNotification,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import type { ManualSupervisionPolicy } from "../../../src/shared/model/assistantManual";
import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";
import { assistantPolicy } from "../../../src/shared/model/assistantPolicy";
import type { AssistantRepository } from "../repository";
import type { AssistantPorts } from "../service";
import type { RoomManagementAdmission } from "../management/assistant-management-turn";

type Notice = Omit<AssistantNotification, "eligible" | "deferredReason"> & {
  acknowledgedAt?: number;
  supersededBy?: string;
  projectId?: string;
  taskId?: string;
  taskCreatedAt?: number;
};
/** What narration sources read from the assistant service. */
export type NarrationSourceDeps = {
  store: { db: AssistantRepository["store"]["db"] };
  repository: Pick<AssistantRepository, "get">;
  now(): number;
  runtime<T>(id: string, fallback: T): Promise<T>;
  profile(): Promise<AssistantProfile>;
  manualPolicy(): Promise<ManualSupervisionPolicy>;
  ports: { taskNotificationAllowed?(notification: AssistantNotification): Promise<boolean> };
  ownerQuestions: {
    get(id: string): Promise<{
      ownerQuestion?: null | {
        status: string;
        sourceCurrent?: boolean;
        version: number;
        sourceToken: string;
        projectIds: string[];
      };
    }>;
  };
};
/** Proactive reminders follow the proactive-speech setting; job updates need the narration switch. */
export const narrationKindAllowed = (profile: AssistantProfile, kind: NarrationEvent["kind"]) =>
  kind === "reminder" ? profile.proactiveSpeech !== "never" : !!profile.voiceNarration;
export const narrationQuietHours = (profile: AssistantProfile, now: number) => {
  const hour = new Date(now).getHours();
  return (
    profile.quietStart !== profile.quietEnd &&
    (profile.quietStart < profile.quietEnd
      ? hour >= profile.quietStart && hour < profile.quietEnd
      : hour >= profile.quietStart || hour < profile.quietEnd)
  );
};
const REMINDER = "notification:reminder:";
/** A fired reminder that is still unacknowledged and recent; spoken once as "Reminder: <text>". */
async function reminderSource(
  deps: NarrationSourceDeps,
  eventId: string,
): Promise<NarrationEvent | undefined> {
  const notice = await deps.runtime<Notice | null>(eventId, null);
  if (
    !notice ||
    notice.kind !== "reminder" ||
    notice.acknowledgedAt !== undefined ||
    notice.supersededBy ||
    notice.createdAt > deps.now() ||
    deps.now() - notice.createdAt > 300_000
  )
    return undefined;
  return {
    eventId,
    kind: "reminder",
    text: `Reminder: ${notice.body}`,
    createdAt: notice.createdAt,
    projectIds: [],
    accountProofs: [],
    sourceVersion: String(notice.createdAt),
  };
}

export async function narrationSource(
  deps: NarrationSourceDeps,
  eventId: string,
): Promise<NarrationEvent | undefined> {
  if (eventId.startsWith(REMINDER)) return reminderSource(deps, eventId);
  if (eventId.startsWith("question:")) {
    const row = await deps.store.db
      .prepare("SELECT value FROM assistant_owner_questions WHERE id=?")
      .get(eventId.slice(9));
    if (!row) return undefined;
    const question = JSON.parse(String(row.value)) as {
      id: string;
      status: string;
      origin: string;
      jobId: string | null;
      createdAt: number;
      projectIds: string[];
      sourceToken: string;
      version: number;
    };
    // Chief questions derive from the canonical job/goal/task/session graph. Proposal
    // questions can carry account context and need a separately verified account lease.
    if (
      question.origin !== "chief" ||
      !question.jobId ||
      question.status !== "open" ||
      !Array.isArray(question.projectIds) ||
      question.createdAt > deps.now() ||
      deps.now() - question.createdAt > 300_000
    )
      return undefined;
    return {
      eventId,
      kind: "question",
      text: "Your assistant needs a decision.",
      createdAt: question.createdAt,
      projectIds: question.projectIds,
      accountProofs: [],
      sourceVersion: `${question.version}:${question.sourceToken}`,
    };
  }
  if (eventId.startsWith("notification:observation:")) {
    const notificationId = eventId.slice("notification:".length);
    const notice = await deps.runtime<Notice | null>(`notification:${notificationId}`, null);
    if (
      !notice ||
      notice.supersededBy ||
      !notice.taskId ||
      !notice.projectId ||
      notice.taskCreatedAt === undefined ||
      !["task.done", "task.needsInput"].includes(notice.kind) ||
      notice.createdAt > deps.now() ||
      deps.now() - notice.createdAt > 300_000
    )
      return undefined;
    const observedId = notificationId.slice("observation:".length);
    const observed = await deps.store.db
      .prepare(
        "SELECT source_id,source_revision,project_ids FROM assistant_observation_events WHERE event_id=? AND source='task'",
      )
      .get(observedId);
    const revision = await deps.store.db
      .prepare(
        "SELECT version FROM assistant_observation_source_revisions WHERE source='task' AND source_id=?",
      )
      .get(notice.taskId);
    const taskRow = await deps.store.db
      .prepare("SELECT value FROM tasks WHERE id=?")
      .get(notice.taskId);
    const task = taskRow
      ? (JSON.parse(String(taskRow.value)) as {
          id: string;
          projectId: string;
          createdAt: number;
          status: string;
          needsInput?: boolean;
        })
      : undefined;
    const manual = await deps.manualPolicy(),
      policy = assistantPolicy(await deps.profile());
    if (
      !observed ||
      observed.source_id !== notice.taskId ||
      observed.source_revision !== `db:${Number(revision?.version)}` ||
      JSON.stringify(JSON.parse(String(observed.project_ids))) !==
        JSON.stringify([notice.projectId]) ||
      !manual.enabled ||
      !manual.projectIds.includes(notice.projectId) ||
      (notice.kind === "task.done"
        ? !policy.observationTaskDone
        : !policy.observationTaskNeedsInput) ||
      !task ||
      task.id !== notice.taskId ||
      task.projectId !== notice.projectId ||
      task.createdAt !== notice.taskCreatedAt ||
      (notice.kind === "task.done"
        ? task.status !== "done"
        : task.status === "done" || !task.needsInput)
    )
      return undefined;
    return {
      eventId,
      kind: notice.kind === "task.done" ? "completed" : "question",
      text:
        notice.kind === "task.done"
          ? "An observed task completed."
          : "An observed task needs your input.",
      createdAt: notice.createdAt,
      projectIds: [notice.projectId],
      sourceVersion: String(observed.source_revision),
    };
  }
  const activity = await deps.repository.get<AssistantActivity>("activity", eventId);
  if (!activity?.jobId) return undefined;
  if (activity.createdAt > deps.now() || deps.now() - activity.createdAt > 300_000)
    return undefined;
  const kind =
    activity.kind === "job.done"
      ? "completed"
      : activity.kind === "job.waiting"
        ? "question"
        : activity.kind === "job.running"
          ? "progress"
          : undefined;
  if (!kind) return undefined;
  const job = await deps.repository.get<AssistantJob>("jobs", activity.jobId);
  if (!job?.projectId) return undefined;
  if (
    (kind === "completed" && job.status !== "done") ||
    (kind === "question" && job.status !== "waiting") ||
    (kind === "progress" && job.status !== "running")
  )
    return undefined;
  const text =
    kind === "completed"
      ? "A job completed."
      : kind === "question"
        ? "A job needs your input."
        : "A job is making progress.";
  return {
    eventId,
    kind,
    text,
    createdAt: activity.createdAt,
    projectIds: assistantJobProjectIds(job),
  };
}
export async function narrationSourceAuthorized(
  deps: NarrationSourceDeps,
  event: NarrationEvent,
): Promise<boolean> {
  if (event.eventId.startsWith(REMINDER)) return !!(await reminderSource(deps, event.eventId));
  if (event.eventId.startsWith("question:")) {
    const question = (await deps.ownerQuestions.get(event.eventId.slice(9))).ownerQuestion;
    return (
      question?.status === "open" &&
      question.sourceCurrent === true &&
      `${question.version}:${question.sourceToken}` === event.sourceVersion &&
      JSON.stringify(question.projectIds) === JSON.stringify(event.projectIds)
    );
  }
  if (event.eventId.startsWith("notification:observation:")) {
    const notice = await deps.runtime<Notice | null>(
      `notification:${event.eventId.slice("notification:".length)}`,
      null,
    );
    return (
      !!notice &&
      (!deps.ports.taskNotificationAllowed ||
        (await deps.ports.taskNotificationAllowed({
          ...notice,
          eligible: false,
          deferredReason: "unknown",
        })))
    );
  }
  return true;
}

type PendingInput = {
  deps: NarrationSourceDeps;
  identity: { threadId: string; generation: string };
  admission: RoomManagementAdmission;
  receipts: { available(threadId: string, eventId: string): Promise<boolean> };
  authorize: AssistantPorts["withVoiceNarrationAuthorization"];
};
/** Up to 20 recent, unclaimed, currently authorized narration events for the owner's live voice. */
export async function pendingNarrationEvents(input: PendingInput): Promise<NarrationEvent[]> {
  const { deps, identity, admission, receipts } = input;
  const profile = await deps.profile();
  const all = [
    ...(await deps.store.db
      .prepare(
        "SELECT id FROM assistant_activity WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
      )
      .all()),
    ...(await deps.store.db
      .prepare(
        "SELECT id FROM assistant_runtime WHERE (id LIKE 'notification:observation:%' OR id LIKE 'notification:reminder:%') AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
      )
      .all()),
  ].map((row) => String(row.id));
  const questions = await deps.store.db
    .prepare(
      "SELECT id FROM assistant_owner_questions WHERE json_extract(value,'$.status')='open' ORDER BY json_extract(value,'$.createdAt') DESC LIMIT 40",
    )
    .all();
  const events: NarrationEvent[] = [];
  for (const id of [...all, ...questions.map((row) => `question:${String(row.id)}`)]) {
    try {
      const event = await narrationSource(deps, id);
      if (
        !event ||
        !narrationKindAllowed(profile, event.kind) ||
        deps.now() - event.createdAt > 300_000 ||
        event.createdAt > deps.now() ||
        !(await receipts.available(identity.threadId, event.eventId))
      )
        continue;
      if (!(await narrationSourceAuthorized(deps, event))) continue;
      if (!input.authorize) break;
      const allowed = await input.authorize(
        {
          threadId: identity.threadId,
          generation: identity.generation,
          eventId: event.eventId,
          projectIds: event.projectIds,
          accountProofs: event.accountProofs,
        },
        admission,
        async (valid) =>
          valid() &&
          (await narrationSourceAuthorized(deps, event)) &&
          JSON.stringify(await narrationSource(deps, event.eventId)) === JSON.stringify(event) &&
          valid(),
      );
      if (allowed) events.push(event);
      if (events.length === 20) break;
    } catch {
      // A missing or revoked source is unavailable; continue with other events.
    }
  }
  return events;
}
