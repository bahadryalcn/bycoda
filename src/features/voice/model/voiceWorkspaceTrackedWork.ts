import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { z } from "zod";
import { pathKey } from "../../../shared/lib/paths";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  ActiveCrewMemberSchema,
  type ActiveCrewMember,
} from "../../../shared/model/host-contracts/crews";
import { HostGoalSchema } from "../../../shared/model/host-contracts/goals";
import { HostTaskSchema } from "../../../shared/model/host-contracts/tasks";
import { remoteMachineFor, remoteRequest } from "../../connections/public/connections";
import type { HostProject, RemoteMachine } from "../../connections/public/protocol";
import { parseRemotePath, remotePath } from "../../connections/public/remoteProjects";
import { isProjectLocked } from "../../group-lock/public/projectLock";

const taskProjection = HostTaskSchema.pick({
  id: true,
  title: true,
  projectId: true,
  status: true,
  sessionId: true,
  updatedAt: true,
  needsInput: true,
}).strip();
const goalProjection = HostGoalSchema.pick({
  id: true,
  title: true,
  projectIds: true,
  leadProjectId: true,
  status: true,
  plannerSessionId: true,
  taskIds: true,
  updatedAt: true,
}).strip();

type Task = z.infer<typeof taskProjection>;
type Goal = z.infer<typeof goalProjection>;
type WorkIdentity = {
  id: string;
  title: string;
  label: string;
  lifecycle: "running" | "done" | "failed" | "stopped" | "interrupted";
  machineId: string;
  environmentId: string;
  projectId: string;
  projectPath: string;
  sessionId?: string;
  updatedAt?: number;
  summary?: string;
  progress?: { done: number; total: number };
};
export type VoiceWorkspaceTrackedWork = WorkIdentity &
  (
    | { kind: "task"; status: Task["status"] }
    | { kind: "goal"; status: Goal["status"]; projectIds: readonly string[] }
    | { kind: "crew"; status: ActiveCrewMember["runStatus"]; definitionId: string }
  );

const taskStates = {
  todo: ["To do", "stopped"],
  queued: ["Queued", "running"],
  running: ["Running", "running"],
  verifying: ["Verifying", "running"],
  review: ["Review", "running"],
  done: ["Completed", "done"],
  blocked: ["Blocked", "stopped"],
} as const;
const goalStates = {
  planning: ["Planning", "running"],
  "awaiting-approval": ["Waiting for approval", "running"],
  running: ["Running", "running"],
  done: ["Completed", "done"],
  blocked: ["Blocked", "stopped"],
  cancelled: ["Cancelled", "stopped"],
} as const;

type WorkSource = {
  path: string;
  machine: Pick<RemoteMachine, "id" | "environmentId">;
  projects: readonly Pick<HostProject, "id" | "cwd">[];
  selectedProjectId: string;
  tasks: readonly Task[];
  goals: readonly Goal[];
  crew: readonly ActiveCrewMember[];
};
type WorkVisibility = {
  paths: readonly string[];
  locked: (path: string) => boolean;
};

function isVisible(path: string, { paths, locked }: WorkVisibility) {
  return !!path && !locked(path) && paths.some((item) => pathKey(item) === pathKey(path));
}

export function projectVoiceWorkspaceWork(
  source: WorkSource,
  visibility: WorkVisibility,
): VoiceWorkspaceTrackedWork[] {
  const remote = parseRemotePath(source.path);
  const visibleProjects = new Map(
    source.projects.flatMap((project) => {
      const path = remote ? remotePath(source.machine.environmentId, project.cwd) : project.cwd;
      return isVisible(path, visibility) ? [[project.id, path] as const] : [];
    }),
  );
  const project = visibleProjects.get(source.selectedProjectId);
  if (
    !project ||
    pathKey(project) !== pathKey(source.path) ||
    (remote && remote.environmentId !== source.machine.environmentId)
  )
    return [];
  const identity = {
    machineId: source.machine.id,
    environmentId: source.machine.environmentId,
    projectId: source.selectedProjectId,
    projectPath: project,
  };
  const scopedTasks = source.tasks.filter((task) => task.projectId === identity.projectId);
  const tasks = scopedTasks.map((task): VoiceWorkspaceTrackedWork => {
    const [label, lifecycle] = taskStates[task.status];
    return {
      ...identity,
      kind: "task",
      id: task.id,
      title: task.title,
      status: task.status,
      label: task.needsInput ? "Needs input" : label,
      lifecycle,
      sessionId: task.sessionId,
      updatedAt: task.updatedAt,
    };
  });
  const tasksById = new Map(scopedTasks.map((task) => [task.id, task]));
  const goals = source.goals
    .filter(
      (goal) =>
        goal.leadProjectId === identity.projectId &&
        goal.projectIds.includes(identity.projectId) &&
        goal.projectIds.every((id) => visibleProjects.has(id)),
    )
    .map((goal): VoiceWorkspaceTrackedWork => {
      const [label, lifecycle] = goalStates[goal.status];
      const children = goal.taskIds.flatMap((id) => {
        const task = tasksById.get(id);
        return task ? [task] : [];
      });
      return {
        ...identity,
        kind: "goal",
        id: goal.id,
        title: goal.title,
        status: goal.status,
        label,
        lifecycle,
        projectIds: goal.projectIds,
        sessionId: goal.plannerSessionId,
        updatedAt: goal.updatedAt,
        progress:
          children.length > 0 && children.length === goal.taskIds.length
            ? {
                done: children.filter((task) => task.status === "done").length,
                total: children.length,
              }
            : undefined,
      };
    });
  const crew = new Map<string, VoiceWorkspaceTrackedWork & { kind: "crew" }>();
  for (const member of source.crew) {
    if (member.projectId !== identity.projectId) continue;
    const row = crew.get(member.runId);
    if (!row) {
      crew.set(member.runId, {
        ...identity,
        kind: "crew",
        id: member.runId,
        title: member.runTitle || member.definitionName,
        status: member.runStatus,
        label: member.runStatus === "active" ? "Active" : "Paused",
        lifecycle: member.runStatus === "active" ? "running" : "stopped",
        summary: member.runTitle ? member.definitionName : undefined,
        sessionId: member.kind === "coordinator" ? member.sessionId : undefined,
        definitionId: member.definitionId,
      });
    } else if (member.kind === "coordinator" && member.sessionId) {
      row.sessionId = member.sessionId;
    }
  }
  return [...tasks, ...goals, ...crew.values()].sort(
    (left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.id.localeCompare(right.id),
  );
}

function readRows<T>(value: unknown, schema: z.ZodType<T>): T[] {
  return Array.isArray(value)
    ? value.flatMap((raw) => {
        const parsed = schema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}

async function readWorkSource(path: string): Promise<WorkSource | undefined> {
  const remote = parseRemotePath(path);
  if (path.startsWith("remote://") && !remote) return undefined;
  const machine = remote
    ? await remoteMachineFor(remote.environmentId)
    : await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine?.id || !machine.environmentId) return undefined;
  if (remote && machine.environmentId !== remote.environmentId) return undefined;
  const read = <T>(method: string, params: Record<string, unknown> = {}) =>
    remoteRequest<T>(machine.id, method, params, false, false, machine.environmentId);
  const [descriptor, projects] = await Promise.all([
    read<{ environmentId: string; capabilities: string[] }>("environment.describe"),
    read<HostProject[]>("projects.list"),
  ]);
  if (descriptor.environmentId !== machine.environmentId || !Array.isArray(descriptor.capabilities))
    return undefined;
  const hostPath = remote?.hostPath ?? path;
  const selected = projects.find((project) => pathKey(project.cwd) === pathKey(hostPath));
  if (!selected) return undefined;
  const query = async (capability: string, method: string, params?: Record<string, unknown>) => {
    if (!descriptor.capabilities.includes(capability)) return undefined;
    // A missing or failed feature must not hide another source that did answer.
    return read<unknown>(method, params).catch(() => undefined);
  };
  const [tasks, goals, crew] = await Promise.all([
    query("tasks", "tasks.list", { projectId: selected.id }),
    query("goals", "goals.list"),
    // The owner `crews.list` can initialize defaults. This view only reads active work.
    query("crews.active.v1", "crews.active.list", { limit: 200 }),
  ]);
  return {
    path,
    machine,
    projects,
    selectedProjectId: selected.id,
    tasks: readRows(tasks, taskProjection),
    goals: readRows(goals, goalProjection),
    crew:
      crew && typeof crew === "object" && "items" in crew
        ? readRows(crew.items, ActiveCrewMemberSchema)
        : [],
  };
}

const noWork: readonly VoiceWorkspaceTrackedWork[] = [];

export function useVoiceWorkspaceTrackedWork({
  enabled,
  projectPath,
  visibleProjectPaths,
}: {
  enabled: boolean;
  projectPath?: string;
  visibleProjectPaths: readonly string[];
}): readonly VoiceWorkspaceTrackedWork[] {
  const [loaded, setLoaded] = useState<WorkSource>();
  const visibility = { paths: visibleProjectPaths, locked: isProjectLocked };
  const path = enabled && projectPath && isVisible(projectPath, visibility) ? projectPath : "";
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Read durable work from this visible project's Host while the fullscreen panel is mounted.
  useEffect(() => {
    setLoaded(undefined);
    if (!path) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let source: WorkSource | undefined;
      try {
        source = await withTimeout(readWorkSource(path), 20_000, "Voice workspace work");
      } catch {
        // Do not present disconnected data as current or switch to another Host.
      }
      if (!active) return;
      setLoaded(source);
      const working =
        source &&
        (source.crew.length > 0 ||
          source.tasks.some((task) => taskStates[task.status][1] === "running") ||
          source.goals.some((goal) => goalStates[goal.status][1] === "running"));
      timer = setTimeout(() => void poll(), working ? 5000 : 15_000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path]);
  return path && loaded && pathKey(loaded.path) === pathKey(path)
    ? projectVoiceWorkspaceWork(loaded, visibility)
    : noWork;
}
