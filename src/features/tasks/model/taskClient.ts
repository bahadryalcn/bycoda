import { remoteRequest as sendHostRequest } from "../../connections/model/connections";
import { subscribeRemoteMachineChannel } from "../../connections/model/remoteMachineChannel";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import {
  isRemoteProvider,
  type HostProject,
  type RemoteMachine,
} from "../../connections/model/protocol";
import {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectCwd,
  hostProjectFor,
  probeMachines,
  type MachineReach,
} from "../../automations/model/hostAutomationClient";
import {
  collectMachineResults,
  type LastGoodLists,
  type MachineResult,
} from "../../automations/model/machineResults";
import { machineProjects, machineCapabilities } from "../../automations/model/machineSnapshot";
import type { HarnessId, RuntimeMode } from "../../sessions/model/session";
import { HOST_TASK_WORKSPACES, type TaskWorkspace } from "./taskWorkspace";
import {
  HOST_TASKS,
  HOST_TASKS_TODO,
  HOST_TASK_CONTINUATION,
  taskColumn,
  type HostTask,
  type HostTaskInput,
  type TaskColumn,
  type TaskStatus,
} from "./hostTasks";

export const TASK_MACHINE_ERROR =
  "This project’s machine isn’t connected, or its bycoda Host needs an update.";
export const TASK_AGENT_ERROR = "This agent cannot run tasks in the background.";

/** A host task as this desktop shows it: on its machine, in its project. */
export type BoardTask = HostTask & {
  machineId: string;
  machineName: string;
  /** How this desktop addresses the task's project. */
  cwd: string;
  /** The machine did not answer; this is what it last reported. */
  stale?: boolean;
  reviewRecheckSupported?: boolean;
  blockedTakeoverSupported?: boolean;
  workspaceControlsSupported?: boolean;
};

/** What the task form edits. A draft with an ID edits that task. */
export type TaskDraft = {
  workspaceLocked?: boolean;
  workspace?: TaskWorkspace;
  id?: string;
  /** Explicit host selected by the owner; edits retain their original host. */
  machineId?: string;
  /** The status of the task being edited. */
  status?: TaskStatus;
  title: string;
  prompt: string;
  cwd: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  maxRunMinutes: number;
  /** Run on a new branch of its own when the project is a git repository. */
  isolate: boolean;
  /** Empty for no check. */
  verifyCommand: string;
  review: boolean;
  /** Merge the branch once every check passes, without waiting for approval. */
  autoMerge: boolean;
  continueUntilDone: boolean;
};

/** Machines whose host keeps a task board, this computer's included. */
export function taskMachines(fresh = false): Promise<RemoteMachine[]> {
  return backgroundMachines(HOST_TASKS, fresh);
}

/** Like `taskMachines`, plus the machines whose tasks cannot be shown. */
export function probeTaskMachines(fresh = false): Promise<MachineReach> {
  return probeMachines(HOST_TASKS, fresh);
}

/** Why some machines' tasks are missing from the board, or null. */
export function missingMachinesNotice(
  reach: Pick<MachineReach, "outdated" | "unreachable">,
  /** Unreachable machines whose last-known tasks are still shown. */
  stale: readonly string[] = [],
): string | null {
  const parts: string[] = [];
  const unreachable = (names: string[], shown: boolean) => {
    if (!names.length) return;
    const one = names.length === 1;
    parts.push(
      `${names.join(", ")} ${one ? "isn’t" : "aren’t"} reachable right now, so ${one ? "its" : "their"} tasks ${shown ? "may be out of date" : "aren’t shown"}.`,
    );
  };
  unreachable(
    reach.unreachable.filter((name) => !stale.includes(name)),
    false,
  );
  unreachable(
    reach.unreachable.filter((name) => stale.includes(name)),
    true,
  );
  if (reach.outdated.length)
    parts.push(
      `Update bycoda Host on ${reach.outdated.join(", ")} to see ${reach.outdated.length === 1 ? "its" : "their"} tasks.`,
    );
  return parts.length ? parts.join(" ") : null;
}

/** Machines whose host also keeps manual to-do items. */
export function todoMachines(fresh = false): Promise<RemoteMachine[]> {
  return backgroundMachines(HOST_TASKS_TODO, fresh);
}

/** Why a to-do item cannot be added for the project at `cwd`: its machine
 * has a task board but an older host. Undefined when it can be added, or when
 * there is no machine at all, which has its own message. */
export function todoUnsupportedMessage(
  machines: readonly RemoteMachine[],
  todoCapable: readonly RemoteMachine[],
  cwd: string,
): string | undefined {
  const machine = backgroundMachineFor(machines, cwd);
  if (!machine || todoCapable.some((entry) => entry.id === machine.id)) return undefined;
  return `Update bycoda Host on ${
    isLocalSyncMachine(machine) ? "this computer" : machine.name
  } to add to-do items`;
}

export function newTaskDraft(cwd: string, harness: HarnessId, model: string): TaskDraft {
  return {
    title: "",
    prompt: "",
    cwd,
    harness,
    model,
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    verifyCommand: "",
    review: false,
    autoMerge: false,
    continueUntilDone: true,
  };
}

export function draftFromTask(task: BoardTask): TaskDraft {
  return {
    id: task.id,
    machineId: task.machineId,
    status: task.status,
    title: task.title,
    prompt: task.prompt,
    cwd: task.cwd,
    harness: task.harness,
    model: task.model,
    modelSettings: task.modelSettings,
    runtimeMode: task.runtimeMode,
    maxRunMinutes: task.maxRunMinutes,
    isolate: task.isolate !== false,
    workspace: task.workspace,
    workspaceLocked: Boolean(task.branch || task.sessionId),
    verifyCommand: task.verifyCommand ?? "",
    review: task.review !== false,
    autoMerge: task.autoMerge === true,
    continueUntilDone: task.continueUntilDone === true,
  };
}

export function boardTaskFromHost(machine: RemoteMachine, cwd: string, task: HostTask): BoardTask {
  return {
    ...task,
    machineId: machine.id,
    machineName: isLocalSyncMachine(machine) ? "this computer" : machine.name,
    cwd,
  };
}

/** One machine's tasks on the board. A task whose project the host no longer
 * has is left out. */
export function boardTasksFromHost(
  machine: RemoteMachine,
  projects: readonly HostProject[],
  tasks: readonly HostTask[],
): BoardTask[] {
  return tasks.flatMap((task) => {
    const project = projects.find((entry) => entry.id === task.projectId);
    return project ? [boardTaskFromHost(machine, hostProjectCwd(machine, project), task)] : [];
  });
}

/** What the host stores for a draft. Throws when the draft's agent cannot run
 * on a host. */
export function hostTaskFromDraft(draft: TaskDraft, id: string, projectId: string): HostTaskInput {
  if (!isRemoteProvider(draft.harness)) throw new Error(TASK_AGENT_ERROR);
  return {
    id,
    title: draft.title,
    prompt: draft.prompt,
    projectId,
    harness: draft.harness,
    model: draft.model,
    modelSettings: draft.modelSettings,
    runtimeMode: draft.runtimeMode,
    maxRunMinutes: draft.maxRunMinutes,
    isolate: draft.isolate,
    ...(draft.workspace ? { workspace: draft.workspace } : {}),
    ...(draft.verifyCommand.trim() ? { verifyCommand: draft.verifyCommand.trim() } : {}),
    review: draft.review,
    ...(draft.continueUntilDone ? { continueUntilDone: true } : {}),
    ...(draft.autoMerge && draft.isolate ? { autoMerge: true } : {}),
  };
}

/** The board's tasks in one column, oldest first; finished columns show the
 * most recently finished first. */
export function tasksInColumn(tasks: readonly BoardTask[], status: TaskColumn): BoardTask[] {
  const column = tasks.filter((task) => taskColumn(task.status) === status);
  return status === "todo" || status === "queued" || status === "running"
    ? column.sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt))
    : column.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
}

/** A span of time as a card shows it: "under 1m", "12m", "3h 5m", "2d 4h". */
export function formatTaskSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`;
}

/** When a card's task got to where it is: how long it has waited or run, or
 * how long ago it finished. */
export function taskTimeLabel(
  task: Pick<HostTask, "status" | "createdAt" | "updatedAt" | "startedAt" | "completedAt">,
  now: number,
): string {
  if (task.status === "todo") return `Added ${formatTaskSpan(now - task.createdAt)} ago`;
  if (task.status === "queued") return `Waiting ${formatTaskSpan(now - task.updatedAt)}`;
  if (task.status === "running")
    return `Running ${formatTaskSpan(now - (task.startedAt ?? task.updatedAt))}`;
  if (task.status === "verifying") return `Verifying ${formatTaskSpan(now - task.updatedAt)}`;
  return `${task.status === "blocked" ? "Stopped" : "Finished"} ${formatTaskSpan(
    now - (task.completedAt ?? task.updatedAt),
  )} ago`;
}

const lastBoardTasks: LastGoodLists<BoardTask> = new Map();
const pendingBoardTaskReads = new Map<string, Promise<BoardTask[]>>();
const taskReadRevisions = new Map<string, number>();
const watchedTasks = new Map<
  string,
  {
    count: number;
    dirty: boolean;
    etag: string;
    stop: () => void;
    listeners: Set<() => void>;
  }
>();

function invalidateBoardTaskRead(machineId: string) {
  taskReadRevisions.set(machineId, (taskReadRevisions.get(machineId) ?? 0) + 1);
  const watch = watchedTasks.get(machineId);
  if (watch) watch.dirty = true;
}

function remoteRequest<T>(...args: Parameters<typeof sendHostRequest>): Promise<T> {
  return sendHostRequest<T>(...args).then((value) => {
    if (args[1] !== "tasks.list") {
      invalidateBoardTaskRead(args[0]);
    }
    return value;
  });
}

/** Task metadata rides the existing machine lane. Board refreshes still update
 * goals/limits, but do not fetch an unchanged task list on capable hosts. */
export function subscribeBoardTaskChanges(
  machines: readonly RemoteMachine[],
  listener: () => void,
): () => void {
  let disposed = false;
  const releases: (() => void)[] = [];
  for (const machine of machines) {
    void machineCapabilities(machine)
      .then((capabilities) => {
        if (disposed || !capabilities.includes("machine.changes")) return;
        let entry = watchedTasks.get(machine.id);
        if (!entry) {
          entry = {
            count: 0,
            dirty: true,
            etag: "",
            stop: () => {},
            listeners: new Set(),
          };
          const current = entry;
          entry.stop = subscribeRemoteMachineChannel(
            machine.id,
            () => ({ tasksKnown: current.etag }),
            (changes) => {
              if (!changes.reset && (!changes.tasks || changes.tasks.etag === current.etag)) return;
              if (changes.tasks) current.etag = changes.tasks.etag;
              invalidateBoardTaskRead(machine.id);
              current.dirty = true;
              for (const notify of current.listeners) {
                try {
                  notify();
                } catch {
                  /* other boards still receive invalidation */
                }
              }
            },
            () => {
              invalidateBoardTaskRead(machine.id);
              current.dirty = true;
              for (const notify of current.listeners) {
                try {
                  notify();
                } catch {
                  /* one failed board refresh cannot interrupt other boards */
                }
              }
            },
          );
          watchedTasks.set(machine.id, entry);
        }
        entry.count++;
        const notify = () => listener();
        entry.listeners.add(notify);
        const current = entry;
        releases.push(() => {
          current.listeners.delete(notify);
          if (--current.count === 0) {
            current.stop();
            watchedTasks.delete(machine.id);
          }
        });
      })
      .catch(() => {});
  }
  return () => {
    disposed = true;
    for (const release of releases) release();
  };
}

/** Each machine's tasks. A machine that does not answer keeps its last
 * successful list, flagged stale; `down` machines are not asked. */
export async function listBoardTaskResults(
  machines: readonly RemoteMachine[],
  down: readonly RemoteMachine[] = [],
  force = false,
): Promise<Array<MachineResult<BoardTask> & { cached?: boolean }>> {
  const cachedMachines = new Set<string>();
  const results = await collectMachineResults(
    lastBoardTasks,
    machines,
    async (machine) => {
      const key = JSON.stringify([
        machine.id,
        machine.environmentId,
        machine.endpoint,
        isLocalSyncMachine(machine),
      ]);
      const pending = pendingBoardTaskReads.get(key);
      if (pending) return pending;
      const watch = watchedTasks.get(machine.id);
      const cached = lastBoardTasks.get(machine.id);
      if (!force && watch && !watch.dirty && cached) {
        cachedMachines.add(machine.id);
        return cached;
      }
      let read!: Promise<BoardTask[]>;
      read = (async () => {
        // Assign the shared promise before a synchronous loader failure can clean it up.
        await Promise.resolve();
        try {
          // All readers share the same request. A confirmed mutation or change
          // during the read requires one follow-up before it can populate the cache.
          for (let attempt = 0; attempt < 2; attempt++) {
            const revision = taskReadRevisions.get(machine.id) ?? 0;
            const currentWatch = watchedTasks.get(machine.id);
            if (currentWatch) currentWatch.dirty = false;
            const [tasks, projects, capabilities] = await Promise.all([
              remoteRequest<HostTask[]>(machine.id, "tasks.list"),
              machineProjects(machine),
              machineCapabilities(machine).catch(() => [] as string[]),
            ]);
            if (revision !== (taskReadRevisions.get(machine.id) ?? 0)) continue;
            return boardTasksFromHost(machine, projects, tasks).map((task) => ({
              ...task,
              reviewRecheckSupported: capabilities.includes("tasks.review-recheck"),
              blockedTakeoverSupported: capabilities.includes("tasks.blocked-takeover"),
              workspaceControlsSupported: capabilities.includes(HOST_TASK_WORKSPACES),
            }));
          }
          throw new Error(
            "The task board changed while loading. Refresh to load its latest state.",
          );
        } catch (error) {
          const currentWatch = watchedTasks.get(machine.id);
          if (currentWatch) currentWatch.dirty = true;
          throw error;
        } finally {
          if (pendingBoardTaskReads.get(key) === read) pendingBoardTaskReads.delete(key);
        }
      })();
      pendingBoardTaskReads.set(key, read);
      return read;
    },
    (task) => ({ ...task, stale: true }),
    down,
  );
  return results.map((result): MachineResult<BoardTask> & { cached?: boolean } =>
    cachedMachines.has(result.machineId) ? { ...result, cached: true } : result,
  );
}

/** Every machine's tasks, last-known ones included. */
export async function listBoardTasks(machines: readonly RemoteMachine[]): Promise<BoardTask[]> {
  return (await listBoardTaskResults(machines)).flatMap((result) => result.data);
}

/** Saves the draft on the machine that owns its project. A new task is added
 * to the queue unless `status` says to do; editing keeps a task's status. */
export async function saveTask(
  machines: readonly RemoteMachine[],
  draft: TaskDraft,
  status: "todo" | "queued" = "queued",
): Promise<BoardTask> {
  const machine = taskMachineFor(machines, draft.cwd, draft.machineId);
  await requireTaskContinuation(machine, draft.continueUntilDone);
  await requireTaskWorkspaces(machine, Boolean(draft.workspace));
  if (status === "todo" && !draft.id) {
    // An older host would queue the item and start it.
    const advertised = await machineCapabilities(machine);
    const unsupported = todoUnsupportedMessage(
      [machine],
      advertised.includes(HOST_TASKS_TODO) ? [machine] : [],
      draft.cwd,
    );
    if (unsupported) throw new Error(unsupported);
  }
  const project = await hostProjectFor(machine, draft.cwd);
  const saved = await remoteRequest<HostTask>(
    machine.id,
    "tasks.save",
    {
      task: {
        ...hostTaskFromDraft(draft, draft.id ?? crypto.randomUUID(), project.id),
        // An older host starts every new task queued, and ignores this.
        ...(draft.id ? {} : { status }),
      },
    },
    false,
    true,
  );
  return {
    ...boardTaskFromHost(machine, hostProjectCwd(machine, project), saved),
    workspaceControlsSupported: (await machineCapabilities(machine)).includes(HOST_TASK_WORKSPACES),
  };
}

/** Resolve the explicit host and verify that the project belongs to it before
 * registering a project or sending any write. Never fall back to another host. */
export function taskMachineFor(
  machines: readonly RemoteMachine[],
  cwd: string,
  machineId?: string,
): RemoteMachine {
  const inferred = backgroundMachineFor(machines, cwd);
  const machine = machineId ? machines.find((entry) => entry.id === machineId) : inferred;
  if (!machine) throw new Error(TASK_MACHINE_ERROR);
  if (!inferred || inferred.id !== machine.id)
    throw new Error("Choose a project on the selected machine.");
  return machine;
}

export async function requireTaskContinuation(
  machine: RemoteMachine,
  enabled: boolean,
): Promise<void> {
  if (enabled && !(await machineCapabilities(machine)).includes(HOST_TASK_CONTINUATION))
    throw new Error(
      `Update bycoda Host on ${isLocalSyncMachine(machine) ? "this computer" : machine.name} to continue tasks until complete.`,
    );
}

function updatedBoardTask(task: BoardTask, updated: HostTask): BoardTask {
  return {
    ...updated,
    machineId: task.machineId,
    machineName: task.machineName,
    cwd: task.cwd,
    reviewRecheckSupported: task.reviewRecheckSupported,
    blockedTakeoverSupported: task.blockedTakeoverSupported,
    workspaceControlsSupported: task.workspaceControlsSupported,
  };
}

export async function moveTask(task: BoardTask, to: TaskStatus): Promise<BoardTask> {
  const moved = await remoteRequest<HostTask>(
    task.machineId,
    "tasks.move",
    { taskId: task.id, to },
    false,
    true,
  );
  return updatedBoardTask(task, moved);
}

export async function startTask(task: BoardTask): Promise<BoardTask> {
  const updated = await remoteRequest<HostTask>(
    task.machineId,
    "tasks.start",
    { taskId: task.id },
    false,
    true,
  );
  return updatedBoardTask(task, updated);
}

export async function retargetTask(
  task: BoardTask,
  workspace?: TaskWorkspace,
  autoMerge?: boolean,
): Promise<BoardTask> {
  const updated = await remoteRequest<HostTask>(
    task.machineId,
    "tasks.retarget",
    {
      taskId: task.id,
      workspace,
      autoMerge,
    },
    false,
    true,
  );
  return updatedBoardTask(task, updated);
}

export async function reorderTasks(tasks: readonly BoardTask[]): Promise<BoardTask[]> {
  if (!tasks.length) return [];
  if (tasks.some((task) => task.machineId !== tasks[0].machineId))
    throw new Error("Reorder tasks on the same machine");
  const updated = await remoteRequest<HostTask[]>(
    tasks[0].machineId,
    "tasks.reorder",
    {
      taskIds: tasks.map((task) => task.id),
    },
    false,
    true,
  );
  return updated.map((task) =>
    updatedBoardTask(
      tasks.find((item) => item.id === task.id)!,
      task,
    ),
  );
}

export async function requireTaskWorkspaces(
  machine: RemoteMachine,
  enabled: boolean,
): Promise<void> {
  if (enabled && !(await machineCapabilities(machine)).includes(HOST_TASK_WORKSPACES))
    throw new Error(
      "Update bycoda Host on the selected machine to choose task workspaces and start controls.",
    );
}

export async function recheckTaskReview(task: BoardTask): Promise<BoardTask> {
  const updated = await remoteRequest<HostTask>(
    task.machineId,
    "tasks.review.recheck",
    { taskId: task.id },
    false,
    true,
  );
  return updatedBoardTask(task, updated);
}

export async function readTaskNotes(task: BoardTask, noteIds: string[]): Promise<BoardTask> {
  const updated = await remoteRequest<HostTask>(
    task.machineId,
    "tasks.notes.read",
    { taskId: task.id, noteIds },
    false,
    true,
  );
  return updatedBoardTask(task, updated);
}

export async function resolveTaskNote(
  task: BoardTask,
  noteId: string,
  resolved: boolean,
): Promise<BoardTask> {
  const updated = await remoteRequest<HostTask>(
    task.machineId,
    "tasks.notes.resolve",
    { taskId: task.id, noteId, resolved },
    false,
    true,
  );
  return updatedBoardTask(task, updated);
}

/** `discard` also removes the branch and worktree of a task that was never
 * merged; the host refuses to delete such a task without it. */
export async function deleteTask(task: BoardTask, discard = false): Promise<void> {
  await remoteRequest(
    task.machineId,
    "tasks.delete",
    { taskId: task.id, ...(discard ? { discard: true } : {}) },
    false,
    true,
  );
}
