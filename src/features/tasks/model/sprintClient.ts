import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import type { BoardTask } from "./taskClient";
import {
  HOST_SPRINTS,
  HOST_TASK_HISTORY,
  SPRINT_STORY_POINTS,
  sprintProjectKey,
  sprintTaskKey,
  type HostSprint,
  type SprintBoard,
  type SprintFields,
  type SprintPlanItem,
  type SprintGoalContext,
  type SprintUpdateInput,
  type SprintProjectRef,
  type SprintReport,
  type SprintSourceEvent,
  type SprintTaskRef,
  type SprintTaskSnapshot,
} from "./hostSprints";

export const STORY_POINTS = SPRINT_STORY_POINTS;
const COORDINATOR_KEY = "bycoda.tasks.planning-environment.v1";
const EMPTY_BOARD: SprintBoard = { sprints: [], planning: [], sources: [] };
type SourceSnapshot = {
  tasks: SprintTaskSnapshot[];
  cursor: number;
  historyAvailableFrom?: number;
};
type SourceEvents = {
  events: SprintSourceEvent[];
  cursor: number;
  hasMore: boolean;
  historyAvailableFrom?: number;
};

export function planningTaskRef(
  task: Pick<BoardTask, "machineId" | "projectId" | "id">,
  machines: readonly RemoteMachine[],
): SprintTaskRef | undefined {
  const machine = machines.find((entry) => entry.id === task.machineId);
  return machine
    ? { environmentId: machine.environmentId, projectId: task.projectId, taskId: task.id }
    : undefined;
}

/** Saved authority is never replaced because a machine is unavailable. */
export function planningCoordinator(
  machines: readonly RemoteMachine[],
  environmentId: string,
): RemoteMachine | undefined {
  return environmentId
    ? machines.find((entry) => entry.environmentId === environmentId)
    : machines.find(isLocalSyncMachine);
}

export function useSprintBoard(
  machines: readonly RemoteMachine[],
  tasks: readonly BoardTask[],
  allowedProjects?: readonly SprintProjectRef[],
) {
  const visible = useQueryVisible();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [environmentId, setEnvironmentId] = useState(() => {
    try {
      return localStorage.getItem(COORDINATOR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [data, setData] = useState<SprintBoard>(EMPTY_BOARD);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [syncFailures, setSyncFailures] = useState<Record<string, string>>({});
  const [supported, setSupported] = useState(false);
  const generation = useRef(0);
  const latestSync = useRef<{
    epoch: number;
    failures: Record<string, string>;
    coordinatorError?: string;
  }>({ epoch: -1, failures: {} });
  const readQueue = useRef<Promise<void>>(Promise.resolve());
  const requests = useRef(new Map<string, string>());
  const knownTasks = useRef(new Set<string>());
  const refs = useRef({ machines, tasks, allowedProjects });
  refs.current = { machines, tasks, allowedProjects };
  const coordinator = planningCoordinator(machines, environmentId);
  const coordinatorId = coordinator?.id;
  const effectiveEnvironment = environmentId || coordinator?.environmentId || "";
  const projectScope = JSON.stringify(
    allowedProjects?.map(sprintProjectKey).sort() ??
      [
        ...new Set(
          tasks.flatMap((task) => {
            const ref = planningTaskRef(task, machines);
            return ref ? [sprintProjectKey(ref)] : [];
          }),
        ),
      ].sort(),
  );
  const requestId = (signature: string) => {
    const key = `${effectiveEnvironment}:${signature}`;
    let id = requests.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      requests.current.set(key, id);
    }
    return id;
  };
  const performRead = useCallback(
    async (sync = true) => {
      if (!coordinatorId || !visibleRef.current) return;
      const epoch = generation.current;
      const current = () => epoch === generation.current;
      setLoading(true);
      try {
        const capabilities = await machineCapabilities(
          refs.current.machines.find((m) => m.id === coordinatorId)!,
        );
        if (!current()) return;
        const available = capabilities.includes(HOST_SPRINTS);
        setSupported(available);
        if (!available) throw new Error("Update the planning Host to use sprints.");
        let board = await remoteRequest<SprintBoard>(coordinatorId, "sprints.list");
        const failures: string[] = [];
        const sourceFailures: Record<string, string> = {};
        if (sync) {
          const { machines: inventory, tasks: taskRows, allowedProjects: projects } = refs.current;
          const allowed = new Set(
            projects?.map(sprintProjectKey) ??
              taskRows.flatMap((task) => {
                const ref = planningTaskRef(task, inventory);
                return ref ? [sprintProjectKey(ref)] : [];
              }),
          );
          const sourceMachines = [
            ...new Map(inventory.map((machine) => [machine.environmentId, machine])).values(),
          ].filter((machine) =>
            [...allowed].some((key) => (JSON.parse(key) as string[])[0] === machine.environmentId),
          );
          for (const sourceEnvironment of new Set(
            [...allowed].map((key) => (JSON.parse(key) as string[])[0]),
          )) {
            if (!sourceMachines.some((source) => source.environmentId === sourceEnvironment)) {
              sourceFailures[sourceEnvironment] = `Machine unavailable: ${sourceEnvironment}`;
              failures.push(sourceFailures[sourceEnvironment]);
            }
          }
          for (const source of sourceMachines) {
            if (!current()) return;
            try {
              const caps = await machineCapabilities(source);
              if (!caps.includes(HOST_TASK_HISTORY))
                throw new Error("Update this Host for sprint history.");
              const projectIds = [...allowed]
                .flatMap((key) => {
                  const [env, id] = JSON.parse(key) as string[];
                  return env === source.environmentId ? [id] : [];
                })
                .sort();
              const scope = JSON.stringify(projectIds);
              const previous = board.sources.find(
                (entry) => entry.environmentId === source.environmentId,
              );
              let cursor = previous?.cursor ?? 0;
              const previousScope = JSON.stringify([...(previous?.visibleProjectIds ?? [])].sort());
              if (!previous || previousScope !== scope) {
                const snapshot = await remoteRequest<SourceSnapshot>(
                  source.id,
                  "tasks.snapshotWithCursor",
                  { projectIds },
                );
                if (!current()) return;
                snapshot.tasks = snapshot.tasks.filter((task) =>
                  allowed.has(
                    sprintProjectKey({
                      environmentId: source.environmentId,
                      projectId: task.projectId,
                    }),
                  ),
                );
                await remoteRequest(coordinatorId, "sprints.ingest", {
                  input: {
                    environmentId: source.environmentId,
                    visibleProjectIds: projectIds,
                    snapshot,
                    cursor: snapshot.cursor,
                    caughtUp: true,
                  },
                });
                snapshot.tasks.forEach((task) =>
                  knownTasks.current.add(
                    sprintTaskKey({
                      environmentId: source.environmentId,
                      projectId: task.projectId,
                      taskId: task.id,
                    }),
                  ),
                );
                cursor = snapshot.cursor;
              }
              // Bound each refresh; remaining pages resume from the committed cursor.
              let caughtUp = false;
              for (let page = 0; page < 10; page++) {
                const result = await remoteRequest<SourceEvents>(source.id, "tasks.events", {
                  after: cursor,
                  limit: 500,
                  projectIds,
                });
                if (!current()) return;
                if (
                  !Number.isSafeInteger(result.cursor) ||
                  result.cursor < cursor ||
                  !Array.isArray(result.events) ||
                  typeof result.hasMore !== "boolean"
                )
                  throw new Error("Invalid task history page.");
                let sequence = cursor;
                for (const event of result.events) {
                  if (event.sequence !== sequence + 1 || event.sequence > result.cursor)
                    throw new Error(
                      "Task history has a gap. Refresh the source machine before continuing.",
                    );
                  sequence = event.sequence;
                }
                if (sequence !== result.cursor || (result.hasMore && sequence === cursor))
                  throw new Error(
                    "Task history has a gap. Refresh the source machine before continuing.",
                  );
                const events = result.events.filter((event) =>
                  allowed.has(
                    sprintProjectKey({
                      environmentId: source.environmentId,
                      projectId: event.projectId,
                    }),
                  ),
                );
                await remoteRequest(coordinatorId, "sprints.ingest", {
                  input: {
                    environmentId: source.environmentId,
                    visibleProjectIds: projectIds,
                    fromCursor: cursor,
                    events,
                    cursor: result.cursor,
                    caughtUp: !result.hasMore,
                  },
                });
                events.forEach((event) => {
                  const key = sprintTaskKey({
                    environmentId: source.environmentId,
                    projectId: event.projectId,
                    taskId: event.taskId,
                  });
                  if (event.deleted) knownTasks.current.delete(key);
                  else knownTasks.current.add(key);
                });
                if (!result.hasMore) {
                  caughtUp = true;
                  break;
                }
                cursor = result.cursor;
              }
              if (!caughtUp)
                throw new Error(
                  "More task history remains. Refresh again before changing this sprint.",
                );
            } catch (reason) {
              const message = `${source.name}: ${reason instanceof Error ? reason.message : String(reason)}`;
              failures.push(message);
              sourceFailures[source.environmentId] = message;
            }
          }
          board = await remoteRequest<SprintBoard>(coordinatorId, "sprints.list");
        }
        if (current()) {
          dataRef.current = board;
          setData(board);
          setError(null);
          if (sync) {
            latestSync.current = { epoch, failures: sourceFailures };
            setSyncErrors(failures);
            setSyncFailures(sourceFailures);
          }
        }
      } catch (reason) {
        if (current()) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(message);
          if (sync) latestSync.current = { epoch, coordinatorError: message, failures: {} };
        }
      } finally {
        if (current()) setLoading(false);
      }
    },
    [coordinatorId, effectiveEnvironment],
  );
  const read = useCallback(
    (sync = true) => {
      const epoch = generation.current;
      const operation = readQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (epoch === generation.current) await performRead(sync);
        });
      readQueue.current = operation;
      return operation;
    },
    [performRead],
  );
  useEffect(() => {
    generation.current++;
    knownTasks.current.clear();
    setData(EMPTY_BOARD);
    setSupported(false);
    setError(null);
    setSyncErrors([]);
    setSyncFailures({});
    return () => {
      generation.current++;
    };
  }, [coordinatorId, effectiveEnvironment]);
  useEffect(() => {
    if (!visible) return;
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => clearInterval(timer);
  }, [read, visible, projectScope]);
  const setCoordinatorEnvironmentId = useCallback((value: string) => {
    try {
      localStorage.setItem(COORDINATOR_KEY, value);
    } catch {
      /* Memory selection still works. */
    }
    setEnvironmentId(value);
  }, []);
  useEffect(() => {
    if (!environmentId && coordinator) setCoordinatorEnvironmentId(coordinator.environmentId);
  }, [environmentId, coordinator?.environmentId, setCoordinatorEnvironmentId]);
  const planning = useMemo(
    () => new Map(data.planning.map((item) => [sprintTaskKey(item), item])),
    [data.planning],
  );
  const requireCoordinator = () => {
    if (!coordinatorId || !supported)
      throw new Error("Reconnect or update the selected planning Host.");
    return coordinatorId;
  };
  const taskRef = (task: BoardTask) => planningTaskRef(task, refs.current.machines);
  const plan = async (task: BoardTask, sprintId: string | null, storyPoints?: number | null) => {
    const id = requireCoordinator();
    const epoch = generation.current;
    if (task.stale) throw new Error("Reconnect this task's machine before changing its plan.");
    const ref = taskRef(task);
    if (!ref) throw new Error("This task's machine is not connected.");
    // A newly created task may not have reached the coordinator's source journal yet.
    if (!knownTasks.current.has(sprintTaskKey(ref))) await read();
    if (epoch !== generation.current)
      throw new Error("The planning Host changed. Refresh before saving.");
    const previous = dataRef.current.planning.find(
      (item) => sprintTaskKey(item) === sprintTaskKey(ref),
    );
    const input = {
      ...ref,
      sprintId,
      ...(storyPoints === undefined ? {} : { storyPoints }),
      expectedRevision: previous?.revision ?? 0,
    };
    const signature = JSON.stringify(["plan", input]);
    try {
      const saved = await remoteRequest<SprintPlanItem>(id, "sprints.plan", {
        input: { ...input, requestId: requestId(signature) },
      });
      if (epoch === generation.current) {
        const next = {
          ...dataRef.current,
          planning: [
            ...dataRef.current.planning.filter(
              (item) => sprintTaskKey(item) !== sprintTaskKey(saved),
            ),
            saved,
          ],
        };
        dataRef.current = next;
        setData(next);
        knownTasks.current.add(sprintTaskKey(ref));
      }
      requests.current.delete(`${effectiveEnvironment}:${signature}`);
      return saved;
    } catch (reason) {
      if (epoch === generation.current) void read(false);
      throw reason;
    }
  };
  const create = async (fields: SprintFields) => {
    const id = requireCoordinator();
    const epoch = generation.current;
    const signature = JSON.stringify(["create", fields]);
    const operationId = requestId(signature);
    try {
      const saved = await remoteRequest<HostSprint>(id, "sprints.create", {
        input: { ...fields, id: operationId, requestId: operationId },
      });
      if (epoch === generation.current) await read(false);
      requests.current.delete(`${effectiveEnvironment}:${signature}`);
      return saved;
    } catch (reason) {
      if (epoch === generation.current) await read(false);
      throw reason;
    }
  };
  const update = async (
    sprint: HostSprint,
    fields: Omit<SprintUpdateInput, "requestId" | "expectedRevision">,
  ) => {
    const epoch = generation.current;
    const signature = JSON.stringify(["update", sprint.id, sprint.revision, fields]);
    try {
      const saved = await remoteRequest<HostSprint>(requireCoordinator(), "sprints.update", {
        id: sprint.id,
        input: { ...fields, expectedRevision: sprint.revision, requestId: requestId(signature) },
      });
      if (epoch === generation.current) await read(false);
      requests.current.delete(`${effectiveEnvironment}:${signature}`);
      return saved;
    } catch (reason) {
      if (epoch === generation.current) await read(false);
      throw reason;
    }
  };
  const command = async (
    sprint: HostSprint,
    action: "start" | "complete" | "archive",
    options?: { rollover?: { taskKeys: string[]; targetSprintId: string | null } },
  ) => {
    const epoch = generation.current;
    const id = requireCoordinator();
    if (action === "start" || action === "complete") {
      const allowed = new Set(
        refs.current.allowedProjects?.map(sprintProjectKey) ??
          sprint.projects.map(sprintProjectKey),
      );
      if (!sprint.projects.every((project) => allowed.has(sprintProjectKey(project))))
        throw new Error("Unlock all sprint projects before changing its lifecycle.");
      await read();
      if (epoch !== generation.current)
        throw new Error("The planning Host changed. Refresh before saving.");
      if (
        latestSync.current.epoch !== epoch ||
        latestSync.current.coordinatorError ||
        sprint.projects.some((project) => latestSync.current.failures[project.environmentId])
      )
        throw new Error(
          "Synchronize all sprint machines before starting or completing the sprint.",
        );
    }
    const signature = JSON.stringify([action, sprint.id, sprint.revision, options]);
    try {
      const saved = await remoteRequest<HostSprint>(id, `sprints.${action}`, {
        id: sprint.id,
        input: { ...options, expectedRevision: sprint.revision, requestId: requestId(signature) },
      });
      if (epoch === generation.current) await read(false);
      requests.current.delete(`${effectiveEnvironment}:${signature}`);
      return saved;
    } catch (reason) {
      if (epoch === generation.current) await read(false);
      throw reason;
    }
  };
  const report = (id: string) =>
    remoteRequest<SprintReport>(requireCoordinator(), "sprints.report", { id });
  const lifecycleIssue = (sprint: HostSprint): string | null => {
    if (!supported || !coordinator || error)
      return error ?? "Reconnect or update the selected planning Host.";
    for (const project of sprint.projects) {
      if (syncFailures[project.environmentId]) return syncFailures[project.environmentId];
      const source = data.sources.find((entry) => entry.environmentId === project.environmentId);
      if (
        !machines.some((machine) => machine.environmentId === project.environmentId) ||
        !source ||
        source.caughtUp === false ||
        Date.now() - source.syncedAt > 60_000 ||
        (source.visibleProjectIds && !source.visibleProjectIds.includes(project.projectId))
      )
        return "Synchronize all sprint machines before starting or completing the sprint.";
    }
    return null;
  };
  const setGoalContext = async (environmentId: string, goalId: string, sprintId: string | null) => {
    const epoch = generation.current;
    const contexts =
      (dataRef.current as SprintBoard & { contexts?: SprintGoalContext[] }).contexts ?? [];
    const previous = contexts.find(
      (item) => item.environmentId === environmentId && item.goalId === goalId,
    );
    const input = { environmentId, goalId, sprintId, expectedRevision: previous?.revision ?? 0 };
    const signature = JSON.stringify(["goalContext", input]);
    try {
      const saved = await remoteRequest<SprintGoalContext>(
        requireCoordinator(),
        "sprints.goalContext",
        { input: { ...input, requestId: requestId(signature) } },
      );
      if (epoch === generation.current) await read(false);
      requests.current.delete(`${effectiveEnvironment}:${signature}`);
      return saved;
    } catch (reason) {
      if (epoch === generation.current) await read(false);
      throw reason;
    }
  };
  return {
    sprints: data.sprints,
    planning,
    sources: data.sources,
    loading,
    error,
    syncErrors,
    syncFailures,
    supported,
    coordinator,
    machines,
    tasks,
    allowedProjects,
    coordinatorEnvironmentId: effectiveEnvironment,
    setCoordinatorEnvironmentId,
    refresh: read,
    plan,
    create,
    update,
    command,
    report,
    taskRef,
    setGoalContext,
    lifecycleIssue,
  };
}

export type SprintBoardController = ReturnType<typeof useSprintBoard>;
