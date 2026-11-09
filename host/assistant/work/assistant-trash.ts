import type { StoreDatabase } from "../../store-db";
import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";
import type {
  AssistantJob,
  AssistantMessage,
  AssistantSnapshot,
} from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantRepository } from "../repository";
import type { HostAssistantManualSessions } from "../sessions/assistant-manual-sessions";
import type { HostAssistantJobDeletion } from "./assistant-job-deletion";

const DAY = 86400000;
type TrashDeps = {
  db: StoreDatabase;
  repository: AssistantRepository;
  manual?: HostAssistantManualSessions;
  jobDeletion?: HostAssistantJobDeletion;
  messageProjectScope(message: AssistantMessage): Promise<{ projectIds?: string[] }>;
};

/** Soft-deleted rows the owner can still restore, newest first. */
export async function readAssistantTrash(
  deps: TrashDeps,
  limit: number,
): Promise<AssistantSnapshot["trash"]> {
  const trash: AssistantSnapshot["trash"] = [];
  for (const kind of ["jobs", "memory", "activity", "messages", "notetrash"] as const) {
    const rows = await deps.db
      .prepare(
        `SELECT id,value,deleted_at FROM assistant_${kind} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`,
      )
      .all(limit);
    for (const row of rows) {
      const value = JSON.parse(row.value);
      let projectId: string | null | undefined, projectIds: string[] | undefined;
      if (kind === "memory" || kind === "notetrash") {
        projectId = null;
        projectIds = [];
      } else if (
        kind === "jobs" &&
        (typeof value.projectId === "string" ||
          (value.kind === "quick" && value.projectId === null))
      ) {
        projectId = value.projectId;
        projectIds = assistantJobProjectIds(value);
      } else if (kind === "messages" && typeof value.threadId === "string") {
        projectIds = (await deps.messageProjectScope(value as AssistantMessage)).projectIds;
        if (projectIds?.length === 0) projectId = null;
        else if (projectIds?.length === 1) projectId = projectIds[0];
      } else if (kind === "activity") {
        if (typeof value.jobId === "string") {
          const job = await deps.repository.get<AssistantJob>("jobs", value.jobId, true);
          if (job) {
            projectId = job.projectId;
            projectIds = assistantJobProjectIds(job);
          }
        } else if (typeof value.supervisionId === "string") {
          projectId = (await deps.manual?.listAllForUsage())?.find(
            (grant) => grant.id === value.supervisionId,
          )?.source.projectId;
          if (projectId) projectIds = [projectId];
        }
      }
      const deletedTaskCount =
        kind === "jobs" ? await deps.jobDeletion?.deletedTaskCount(String(row.id)) : undefined;
      trash.push({
        id: `${kind}:${row.id}`,
        kind,
        ...(projectId === undefined ? {} : { projectId }),
        ...(projectIds === undefined ? {} : { projectIds }),
        ...(deletedTaskCount === undefined ? {} : { deletedTaskCount }),
        title: String(value.title ?? value.text ?? value.summary ?? "").slice(0, 300),
        deletedAt: row.deleted_at,
        expiresAt: row.deleted_at + 7 * DAY,
      });
    }
  }
  return trash.sort((a, b) => b.deletedAt - a.deletedAt).slice(0, limit);
}
