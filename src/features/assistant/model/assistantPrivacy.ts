import type {
  AssistantActivity,
  AssistantMessage,
  AssistantSnapshot,
  AssistantTrash,
} from "../../../shared/model/host-contracts/assistant";
import type { ManualProject } from "./assistantManual";
import { assistantJobProjectIds, assistantJobVisible } from "./assistantJobs";

export type AssistantPrivacyScope = {
  projectIds: ReadonlySet<string>;
  unrestricted: boolean;
  key: string;
};
export function canReadAssistantBriefing(
  source: AssistantSnapshot,
  scope: AssistantPrivacyScope,
): boolean {
  const projects = source.briefing?.projectIds;
  return Array.isArray(projects) && projects.every((id) => scope.projectIds.has(id));
}
export function assistantPrivacyScope(
  known: readonly ManualProject[] | null,
  visible: readonly ManualProject[],
  snapshot: AssistantSnapshot | null,
): AssistantPrivacyScope {
  const projectIds = new Set(visible.flatMap((project) => (project.id ? [project.id] : [])));
  const referenced = [
    ...(known ?? []).map((project) => project.id),
    ...(snapshot?.jobs ?? []).flatMap(assistantJobProjectIds),
    ...(snapshot?.threads ?? []).map((thread) => thread.projectId),
    ...(snapshot?.manualGrants ?? []).map((grant) => grant.source.projectId),
  ].filter((id): id is string => !!id);
  const unrestricted = known !== null && referenced.every((id) => projectIds.has(id));
  return { projectIds, unrestricted, key: JSON.stringify([unrestricted, [...projectIds].sort()]) };
}
const globalActivity = new Set([
  "profile.updated",
  "memory.saved",
  "manual.policy",
  "budget.exhausted",
]);
function sessionProjects(snapshot: AssistantSnapshot): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const job of snapshot.jobs)
    for (const id of job.sessionIds)
      result.set(id, [...new Set([...(result.get(id) ?? []), ...assistantJobProjectIds(job)])]);
  for (const grant of snapshot.manualGrants ?? [])
    result.set(grant.sessionId, [
      ...new Set([...(result.get(grant.sessionId) ?? []), grant.source.projectId]),
    ]);
  return result;
}
function activityVisible(
  item: AssistantActivity,
  source: AssistantSnapshot,
  scope: AssistantPrivacyScope,
): boolean {
  if (item.jobId)
    return source.jobs.some(
      (job) => job.id === item.jobId && assistantJobVisible(job, (id) => scope.projectIds.has(id)),
    );
  if (item.supervisionId)
    return (source.manualGrants ?? []).some(
      (grant) => grant.id === item.supervisionId && scope.projectIds.has(grant.source.projectId),
    );
  if (item.sessionId) {
    const projectIds = sessionProjects(source).get(item.sessionId);
    return !!projectIds?.length && projectIds.every((id) => scope.projectIds.has(id));
  }
  return (
    globalActivity.has(item.kind) || (scope.unrestricted && !/^(job|task|manual)\./.test(item.kind))
  );
}
function trashVisible(
  entry: AssistantTrash,
  source: AssistantSnapshot,
  scope: AssistantPrivacyScope,
): boolean {
  if (entry.kind === "memory" || entry.kind === "notetrash") return true;
  if (Array.isArray(entry.projectIds))
    return entry.projectIds.every((id) => scope.projectIds.has(id));
  const explicit = entry.projectId;
  if (explicit !== undefined) return explicit === null || scope.projectIds.has(explicit);
  if (entry.kind === "jobs")
    return source.jobs.some(
      (job) =>
        (entry.id === job.id || entry.id === `jobs:${job.id}`) &&
        assistantJobVisible(job, (id) => scope.projectIds.has(id)),
    );
  if (entry.kind === "activity")
    return source.activity.some(
      (item) =>
        (entry.id === item.id || entry.id === `activity:${item.id}`) &&
        activityVisible(item, source, scope),
    );
  return false;
}

/** Renderer projection only. Never mutate shared Host caches or manufacture authority. */
export function projectAssistantSnapshot(
  source: AssistantSnapshot | null,
  scope: AssistantPrivacyScope,
): AssistantSnapshot | null {
  if (!source) return null;
  return {
    ...source,
    jobs: source.jobs.filter((job) => assistantJobVisible(job, (id) => scope.projectIds.has(id))),
    threads: source.threads.filter(
      (thread) => !thread.projectId || scope.projectIds.has(thread.projectId),
    ),
    activity: source.activity.filter((item) => activityVisible(item, source, scope)),
    trash: source.trash.filter((entry) => trashVisible(entry, source, scope)),
    manualGrants: source.manualGrants?.filter((grant) =>
      scope.projectIds.has(grant.source.projectId),
    ),
    notifications: source.notifications?.filter((notification) =>
      notification.projectIds
        ? notification.projectIds.every((id) => scope.projectIds.has(id))
        : notification.jobId
          ? source.jobs.some(
              (job) =>
                job.id === notification.jobId &&
                assistantJobVisible(job, (id) => scope.projectIds.has(id)),
            )
          : notification.projectId
            ? scope.projectIds.has(notification.projectId)
            : notification.kind !== "briefing" || canReadAssistantBriefing(source, scope),
    ),
    // An unstructured Host briefing cannot be safely redacted by the renderer.
    briefing: canReadAssistantBriefing(source, scope) ? source.briefing : null,
    chiefReview:
      source.chiefReview && !scope.unrestricted
        ? { ...source.chiefReview, message: "" }
        : source.chiefReview,
  };
}

export function visibleAssistantMessages(
  messages: readonly AssistantMessage[],
  source: AssistantSnapshot,
  scope: AssistantPrivacyScope,
): AssistantMessage[] {
  const threads = new Set(
    source.threads
      .filter((thread) => !thread.projectId || scope.projectIds.has(thread.projectId))
      .map((thread) => thread.id),
  );
  const jobs = new Set(
    source.jobs
      .filter((job) => assistantJobVisible(job, (id) => scope.projectIds.has(id)))
      .map((job) => job.id),
  );
  const sessions = sessionProjects(source);
  return messages.filter((message) => {
    const contributors = message.projectIds;
    if (Array.isArray(contributors)) {
      const thread = source.threads.find((thread) => thread.id === message.threadId);
      return (
        (!thread || !thread.projectId || scope.projectIds.has(thread.projectId)) &&
        contributors.every((id) => scope.projectIds.has(id))
      );
    }
    return (
      threads.has(message.threadId) &&
      message.jobIds.every((id) => jobs.has(id)) &&
      (!message.sessionId ||
        (sessions.get(message.sessionId)?.length &&
          sessions.get(message.sessionId)!.every((id) => scope.projectIds.has(id))))
    );
  });
}
