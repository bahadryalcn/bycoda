import { useEffect, useState } from "react";
import { pathKey } from "../../../shared/lib/paths";
import type {
  AssistantJob,
  AssistantJobStatus,
  AssistantResponse,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import { isProjectLocked } from "../../group-lock/public/projectLock";

type WorkspaceScope = { kind: "global" } | { kind: "project"; path: string };
type Project = { id: string; path: string; name: string };
type WorkspaceVisibility = {
  visibleProjectPaths: readonly string[];
  scope: WorkspaceScope;
  jobVisible: (job: AssistantJob, visible: (projectId: string) => boolean) => boolean;
  jobProjectIds: (job: AssistantJob) => readonly string[];
};

export type VoiceWorkspaceJob = {
  id: string;
  environmentId: string;
  title: string;
  status: AssistantJobStatus;
  dispatchState: AssistantJob["dispatchState"];
  progress: Readonly<AssistantJob["progress"]>;
  summary: string;
  updatedAt: number;
  projectNames: readonly string[];
  sessionIds: readonly string[];
  taskIds: readonly string[];
  goalId?: string;
};

/** Labels preserve the Assistant job lifecycle, including queued and paused work. */
export const voiceWorkspaceJobStatus = {
  queued: { label: "Queued", filter: "running" },
  planning: { label: "Planning", filter: "running" },
  running: { label: "Working", filter: "running" },
  stalled: { label: "Stalled", filter: "interrupted" },
  waiting: { label: "Waiting", filter: "running" },
  done: { label: "Completed", filter: "done" },
  failed: { label: "Failed", filter: "failed" },
  paused: { label: "Paused", filter: "stopped" },
  cancelled: { label: "Cancelled", filter: "stopped" },
} as const satisfies Record<AssistantJobStatus, { label: string; filter: string }>;

/** Require every contributor to remain visible, before disclosing even a job title. */
export function voiceWorkspaceJobs(
  jobs: readonly AssistantJob[],
  environmentId: string,
  projects: readonly Project[],
  { visibleProjectPaths, scope, jobVisible, jobProjectIds }: WorkspaceVisibility,
  locked: (path: string) => boolean = isProjectLocked,
): VoiceWorkspaceJob[] {
  const visible = new Set(visibleProjectPaths.filter(Boolean).map(pathKey));
  const selected = scope.kind === "project" && scope.path ? pathKey(scope.path) : undefined;
  const allowed = new Map(
    projects
      .filter(
        (project) =>
          project.path &&
          visible.has(pathKey(project.path)) &&
          !locked(project.path) &&
          (scope.kind === "global" || pathKey(project.path) === selected),
      )
      .map((project) => [project.id, project.name]),
  );
  return jobs
    .filter((job) => {
      if (!jobVisible(job, (id) => allowed.has(id))) return false;
      return scope.kind === "global" || jobProjectIds(job).length > 0;
    })
    .map((job): VoiceWorkspaceJob => ({
      id: job.id,
      environmentId,
      title: job.title,
      status: job.status,
      dispatchState: job.dispatchState,
      progress: job.progress,
      summary: job.summary,
      updatedAt: job.updatedAt,
      projectNames: jobProjectIds(job)
        .map((id) => allowed.get(id) ?? "")
        .filter(Boolean),
      sessionIds:
        job.kind === "quick"
          ? job.sessionIds
          : job.sessionIds.filter((id) => !job.detachedSessionIds?.includes(id)),
      taskIds: job.taskIds,
      goalId: job.goalId,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

type WorkspaceJobsInput = WorkspaceVisibility & {
  enabled: boolean;
  snapshot: Pick<AssistantSnapshot, "jobs"> | null | undefined;
  environmentId: string | null | undefined;
  request: (
    input: { op: "projects.list" },
    environmentId: string,
  ) => Promise<Pick<AssistantResponse, "projects">>;
};

const emptyJobs: readonly VoiceWorkspaceJob[] = [];

/** Share the caller's live snapshot. Read only its own Host's project directory. */
export function useVoiceWorkspaceJobs({
  enabled,
  snapshot,
  environmentId,
  request,
  ...visibility
}: WorkspaceJobsInput): readonly VoiceWorkspaceJob[] {
  const [directory, setDirectory] = useState<{
    environmentId: string;
    projects: readonly Project[];
  }>();
  const source = enabled ? environmentId : undefined;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Resolve this mounted panel's external Host project directory and discard late results.
  useEffect(() => {
    setDirectory(undefined);
    if (!source) return;
    let current = true;
    void request({ op: "projects.list" }, source)
      .then(({ projects }) => {
        if (current) setDirectory(projects ? { environmentId: source, projects } : undefined);
      })
      .catch(() => {
        if (current) setDirectory(undefined);
      });
    return () => {
      current = false;
    };
  }, [source, request]);
  if (!source || directory?.environmentId !== source || !snapshot?.jobs?.length) return emptyJobs;
  return voiceWorkspaceJobs(snapshot.jobs, source, directory.projects, visibility);
}
