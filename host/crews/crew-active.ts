import type { CrewAgent, CrewRun } from "../../src/features/crews/model/crew";
import type { ActiveCrewMember } from "../../src/shared/model/host-contracts/crews";
import type { HostStore } from "../store";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { readActiveCrewRuns } from "./crew-scheduler-projection";

export const ACTIVE_CREW_DEFAULT_LIMIT = 200;
/** Upper bound on runs scanned per call; a larger host reports `truncated`. */
const MAX_RUNS = 200;

export type ActiveCrewList = { items: ActiveCrewMember[]; truncated?: true };
type Ports = {
  store: Pick<HostStore, "db" | "projects" | "sessionStateMetadata" | "transactionActive">;
  tasks: { taskIndex(ids?: readonly string[]): Promise<ReadonlyMap<string, HostTask>> };
};

const identity = (agent: CrewAgent) => ({
  memberId: agent.id,
  memberName: agent.name,
  memberRole: agent.role,
  ...(agent.avatar ? { avatar: agent.avatar } : {}),
  ...(agent.handle ? { handle: agent.handle } : {}),
  ...(agent.source ? { memberSource: { id: agent.source.id } } : {}),
});

/** Rows for one run; identity always comes from the run's definition snapshot. */
function runMembers(
  run: CrewRun,
  projectName: string | undefined,
  tasks: ReadonlyMap<string, HostTask>,
  coordinatorRunning: boolean,
): ActiveCrewMember[] {
  const base = {
    runId: run.id,
    projectId: run.projectId,
    ...(projectName ? { projectName } : {}),
    definitionId: run.definition.id,
    definitionName: run.definition.name,
    ...(run.title ? { runTitle: run.title } : {}),
    runStatus: run.status as "active" | "paused",
  };
  const rows: ActiveCrewMember[] = [];
  const coordinator = run.definition.agents.find((agent) => agent.role === "coordinator");
  const unresolved = run.messages.some((message) => message.resolvedAt === undefined);
  if (coordinator && (coordinatorRunning || unresolved))
    rows.push({
      ...base,
      ...identity(coordinator),
      kind: "coordinator",
      ...(run.coordinatorSessionId ? { sessionId: run.coordinatorSessionId } : {}),
      ...(unresolved ? { attention: "decision" as const } : {}),
    });
  const reviewer = run.definition.agents.find((agent) => agent.role === "reviewer");
  const seen = new Set<string>();
  for (const assignment of run.assignments) {
    const task = tasks.get(assignment.taskId);
    if (!task || task.crewRunId !== run.id || seen.has(task.id)) continue;
    seen.add(task.id);
    const taskFields = {
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
    };
    const member = run.definition.agents.find((agent) => agent.id === assignment.memberId);
    if (task.reviewer && task.status === "verifying" && reviewer)
      rows.push({
        ...base,
        ...identity(reviewer),
        kind: "review",
        ...taskFields,
        startedAt: task.reviewer.startedAt,
        ...(task.reviewer.sessionId ? { sessionId: task.reviewer.sessionId } : {}),
      });
    if (!member) continue;
    const attention =
      task.status === "review" ? "review" : task.status === "blocked" ? "blocked" : undefined;
    if (task.status !== "running" && !attention) continue;
    rows.push({
      ...base,
      ...identity(member),
      kind: "worker",
      ...taskFields,
      ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      ...(attention ? { attention } : {}),
    });
  }
  return rows;
}

/**
 * Host-wide read (or one project when `projectId` is given) of crew members that are working or waiting on someone. It reads only unfinished
 * runs and one keyed task lookup. The coordinator counts as running only when Host-owned session
 * metadata says so; a native (desktop) coordinator would need session I/O, so it appears only
 * with an unresolved message (attention "decision"). It never initializes defaults.
 */
export async function listActiveCrewMembers(
  ports: Ports,
  limit?: number,
  projectId?: string,
): Promise<ActiveCrewList> {
  const cap = limit ?? ACTIVE_CREW_DEFAULT_LIMIT;
  const all = await readActiveCrewRuns(ports.store as HostStore, MAX_RUNS + 1);
  // shortcut: the project filter runs after the host-wide MAX_RUNS scan; push it into the query if a host exceeds that many unfinished runs.
  const fetched = projectId ? all.filter((run) => run.projectId === projectId) : all;
  const runs = fetched.slice(0, MAX_RUNS);
  let truncated = fetched.length > MAX_RUNS;
  const taskIds = runs.flatMap((run) => run.assignments.map((assignment) => assignment.taskId));
  const [tasks, projects] = await Promise.all([
    ports.tasks.taskIndex([...new Set(taskIds)]),
    ports.store.projects(),
  ]);
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const items: ActiveCrewMember[] = [];
  for (const run of runs) {
    const meta = run.coordinatorSessionId
      ? await ports.store.sessionStateMetadata(run.coordinatorSessionId)
      : undefined;
    const running = !!meta && !meta.desktop && meta.status === "running";
    items.push(...runMembers(run, names.get(run.projectId), tasks, running));
    if (items.length > cap) break;
  }
  if (items.length > cap) truncated = true;
  return { items: items.slice(0, cap), ...(truncated ? { truncated: true as const } : {}) };
}
