import type {
  AssistantEffectivePresence,
  AssistantNotification,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import { assistantPolicy } from "../../../src/shared/model/assistantPolicy";
import type { StoreDatabase } from "../../store-db";
import { assistantNotificationUrgent } from "../work/assistant-job-holds";

export type PendingNotification = Omit<AssistantNotification, "eligible" | "deferredReason"> & {
  acknowledgedAt?: number;
  supersededBy?: string;
};

type NotificationPorts = {
  db: Pick<StoreDatabase, "prepare">;
  presence(): Promise<AssistantEffectivePresence>;
  now(): number;
  manualPolicy(): Promise<{ enabled: boolean; projectIds: string[] }>;
  profile(): Promise<AssistantProfile>;
  taskNotificationAllowed?(notification: AssistantNotification): Promise<boolean>;
  jobWaitingApprovals(jobId: string): Promise<boolean>;
  safeOutput(text: string): Promise<string>;
};

/** Current pending notifications with their source, task identity and delivery policy revalidated. */
export async function readAssistantNotifications(
  profile: AssistantProfile,
  ports: NotificationPorts,
): Promise<AssistantNotification[]> {
  const rows = await ports.db
    .prepare(
      "SELECT value FROM assistant_runtime WHERE id LIKE 'notification:%' AND deleted_at IS NULL AND json_extract(value,'$.value.acknowledgedAt') IS NULL AND json_extract(value,'$.value.supersededBy') IS NULL AND (?=1 OR json_extract(value,'$.value.kind') NOT IN ('task.done','task.needsInput')) ORDER BY updated_at,id LIMIT 100",
    )
    .all(ports.taskNotificationAllowed ? 1 : 0);
  const presence = await ports.presence(),
    hour = new Date(ports.now()).getHours();
  const quiet =
    profile.quietStart !== profile.quietEnd &&
    (profile.quietStart < profile.quietEnd
      ? hour >= profile.quietStart && hour < profile.quietEnd
      : hour >= profile.quietStart || hour < profile.quietEnd);
  const approvals = new Map<string, Promise<boolean>>();
  const disclosed = await Promise.all(
    rows.map(async (row) => {
      const {
        acknowledgedAt: _,
        supersededBy: __,
        ...value
      } = (JSON.parse(row.value) as { value: PendingNotification }).value;
      if (value.kind === "task.done" || value.kind === "task.needsInput") {
        if (
          !value.projectId ||
          !value.taskId ||
          value.taskCreatedAt === undefined ||
          !ports.taskNotificationAllowed ||
          !(await ports.taskNotificationAllowed({
            ...value,
            eligible: false,
            deferredReason: "unknown",
          }))
        )
          return null;
        const currentManual = await ports.manualPolicy();
        const currentProfile = await ports.profile();
        const currentPolicy = assistantPolicy(currentProfile);
        if (
          !currentManual.enabled ||
          !currentManual.projectIds.includes(value.projectId) ||
          !currentProfile.enabled ||
          !currentProfile.setupComplete ||
          (value.kind === "task.done"
            ? !currentPolicy.observationTaskDone
            : !currentPolicy.observationTaskNeedsInput)
        )
          return null;
        const row = await ports.db.prepare("SELECT value FROM tasks WHERE id=?").get(value.taskId);
        const task = row
          ? (JSON.parse(String(row.value)) as {
              id?: string;
              projectId?: string;
              status?: string;
              needsInput?: boolean;
              createdAt?: number;
            })
          : undefined;
        if (
          !task ||
          task.id !== value.taskId ||
          task.projectId !== value.projectId ||
          task.createdAt !== value.taskCreatedAt ||
          (value.kind === "task.done"
            ? task.status !== "done"
            : task.needsInput !== true || task.status === "done")
        )
          return null;
        if (
          !(await ports.taskNotificationAllowed({
            ...value,
            eligible: false,
            deferredReason: "unknown",
          }))
        )
          return null;
      }
      let urgent = assistantNotificationUrgent(value.kind);
      if (value.kind === "job.waiting" && value.jobId) {
        let pending = approvals.get(value.jobId);
        if (!pending) {
          pending = ports.jobWaitingApprovals(value.jobId);
          approvals.set(value.jobId, pending);
        }
        urgent = await pending;
      }
      const policy = assistantPolicy(profile),
        choice = presence === "present" ? policy.notificationPresent : policy.notificationAway;
      const reason: AssistantNotification["deferredReason"] =
        !profile.enabled || !profile.setupComplete
          ? "unknown"
          : presence === "dnd"
            ? "dnd"
            : quiet
              ? "quiet"
              : choice === "all" || (choice === "urgent" && urgent)
                ? null
                : presence === "present"
                  ? "settings"
                  : presence;
      return {
        ...value,
        title: (await ports.safeOutput(value.title)).slice(0, 200),
        body: (await ports.safeOutput(value.body)).slice(0, 2000),
        eligible: reason === null,
        deferredReason: reason,
        urgent,
        repeatCount: profile.urgentNotificationRepeats ?? 2,
        repeatIntervalMinutes: profile.urgentNotificationIntervalMinutes ?? 30,
      };
    }),
  );
  return disclosed.filter((item) => item !== null).slice(0, 100);
}
