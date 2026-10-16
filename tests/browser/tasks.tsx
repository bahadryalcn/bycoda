import { createRoot } from "react-dom/client";
import { TasksView } from "../../src/features/tasks/ui/TasksView";
import type { BackgroundSessionTarget } from "../../src/features/tasks/model/backgroundSession";
import {
  canMoveTask,
  type HostTask,
  type HostTaskInput,
  type TaskStatus,
} from "../../src/features/tasks/model/hostTasks";
import type { HostGoal, HostGoalInput } from "../../src/features/tasks/model/hostGoals";
import type { HostProject, RemoteMachine } from "../../src/features/connections/model/protocol";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  saveLastModelChoice,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import { languageReady, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// All operations use fictitious in-memory hosts. These tests never connect to a
// live provider, modify a user repository, or start background agent sessions.
const query = new URLSearchParams(location.search);
const localPath = "C:/fixture/local-project";
const remotePath = "remote://env-remote/fixture/remote-project";
const machines: RemoteMachine[] = [
  {
    id: "machine-remote",
    name: "Demo MacBook",
    endpoint: "http://127.0.0.1:45000",
    environmentId: "env-remote",
    ssh: { target: "demo@macbook.test", remotePort: 3774 },
  },
  ...(!query.has("noLocal")
    ? [
        {
          id: "machine-local",
          name: "Renamed development PC",
          endpoint: "http://127.0.0.1:3774",
          environmentId: "env-local",
          localHost: true,
        },
      ]
    : []),
];
const projects: Record<string, HostProject[]> = {
  "machine-local": [
    { id: "local-project", cwd: localPath, name: "local-project" },
    { id: "local-docs", cwd: "C:/fixture/local-docs", name: "local-docs" },
  ],
  "machine-remote": [
    {
      id: "remote-project",
      cwd: "/fixture/remote-project",
      name: "remote-project",
    },
    { id: "remote-api", cwd: "/fixture/remote-api", name: "remote-api" },
  ],
};
const tasks: Record<string, HostTask[]> = {
  "machine-local": [],
  "machine-remote": [],
};
const goals: Record<string, HostGoal[]> = {
  "machine-local": [],
  "machine-remote": [],
};
const trees = new Map<string, { path: string; branch: string }[]>();
const limits = new Map<string, { maxRunningTasks: number; dailyAgentMinutes: number }>();
if (query.has("boardControls")) {
  const defaults: HostTaskInput = {
    id: "first",
    title: "First queued task",
    prompt: "Fixture instructions",
    projectId: "local-project",
    harness: "claude",
    model: "claude:fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    goalId: "controls-goal",
  };
  tasks["machine-local"] = [
    { ...defaults, status: "queued", createdAt: 1, updatedAt: 1 },
    {
      ...defaults,
      id: "second",
      title: "Second queued task",
      status: "queued",
      createdAt: 2,
      updatedAt: 2,
    },
    {
      ...defaults,
      id: "review",
      title: "Completed task",
      status: "review",
      branch: "mc/result",
      baseBranch: "main",
      sessionId: "completed-worker",
      mergeError: "The project has uncommitted changes.",
      createdAt: 3,
      updatedAt: 3,
    },
  ];
  goals["machine-local"] = [
    {
      id: "controls-goal",
      title: "Settings goal",
      prompt: "Fixture goal",
      projectIds: ["local-project"],
      leadProjectId: "local-project",
      harness: "claude",
      model: "claude:fixture",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      verifyDefaults: { review: true },
      approvePlan: false,
      status: "running",
      taskIds: ["first", "second", "review"],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
}
const calls: { command: string; args: Record<string, unknown> }[] = [];
const openedSessions: BackgroundSessionTarget[] = [];
let projectFailure = query.has("projectError");
const slowRemoteMethod = query.get("slowRemote");
let remoteReleased = false;
let releaseRemote!: () => void;
const remoteGate = new Promise<void>((resolve) => {
  releaseRemote = () => {
    remoteReleased = true;
    resolve();
  };
});
if (slowRemoteMethod) {
  const now = Date.now();
  tasks["machine-remote"].push({
    id: "remote-existing",
    title: "Remote task arrived",
    prompt: "A remote fixture task.",
    projectId: "remote-project",
    harness: "claude",
    model: "claude:fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    status: "todo",
    createdAt: now,
    updatedAt: now,
  });
}
const linkedMachine = query.get("sessionLinks");
if (linkedMachine) {
  const machineId = linkedMachine === "remote" ? "machine-remote" : "machine-local";
  const now = Date.now();
  tasks[machineId].push({
    id: "session-linked-task",
    title: "Session-linked task",
    prompt: "Complete the isolated fixture task.",
    projectId: linkedMachine === "remote" ? "remote-project" : "local-project",
    harness: "claude",
    model: "claude:fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    status: "verifying",
    sessionId: "worker-current",
    reviewer: { sessionId: "review-current", startedAt: now },
    worktreeCwd:
      linkedMachine === "remote" ? "/fixture/worktrees/task" : "C:/fixture/worktrees/task",
    verification: {
      review: {
        sessionId: "review-previous",
        verdict: "fail",
        note: "Earlier review findings",
      },
    },
    attemptHistory: [
      {
        attempt: 0,
        at: now - 1000,
        workerSessionId: "worker-retained",
        reviewerSessionId: "review-retained",
        workerSummary: "Initial attempt",
        verdict: "fail",
        note: "Earlier findings",
        findings: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
}
Object.assign(window, {
  taskFixtureCalls: calls,
  taskFixtureOpenedSessions: openedSessions,
  taskFixtureReleaseRemote: releaseRemote,
  taskFixtureRemoteReleased: () => remoteReleased,
  taskFixtureRecoverProjects: () => {
    projectFailure = false;
  },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "remote_machines") return structuredClone(machines);
      if (command === "plugin:event|listen") return 1;
      if (command !== "remote_request") return null;
      const machineId = String(args.machineId);
      const machine = machines.find((entry) => entry.id === machineId);
      if (!machine) throw new Error("Unknown fixture machine");
      const params = (args.params ?? {}) as Record<string, unknown>;
      if (machineId === "machine-remote" && args.method === slowRemoteMethod) await remoteGate;
      switch (args.method) {
        case "environment.describe":
          return {
            protocolVersion: 1,
            environmentId: machine.environmentId,
            name: machine.name,
            capabilities: [
              "tasks",
              "tasks.todo",
              "tasks.workspaces",
              "goals.direct-checkout",
              "goals.settings",
              "goals",
              "host.settings",
              "tasks.continue-until-done",
              ...(query.has("changes") ? ["machine.changes"] : []),
            ],
          };
        case "projects.list":
          if (machineId === "machine-remote" && projectFailure)
            throw new Error("Demo MacBook project discovery failed");
          return structuredClone(projects[machineId]);
        case "projects.open": {
          const project = projects[machineId].find((entry) => entry.cwd === params.cwd);
          if (!project) throw new Error("Project belongs to a different fixture machine");
          return structuredClone(project);
        }
        case "tasks.list":
          return structuredClone(tasks[machineId]);
        case "goals.list":
          return structuredClone(goals[machineId]);
        case "goals.update": {
          if (query.has("goalSaveError")) throw new Error("Fixture goal save failed");
          const goal = goals[machineId].find((entry) => entry.id === params.goalId)!;
          Object.assign(goal, params.settings, { updatedAt: goal.updatedAt + 1 });
          return structuredClone(goal);
        }
        case "host.settings.get":
          return {
            ...(limits.get(machineId) ?? { maxRunningTasks: 2, dailyAgentMinutes: 0 }),
            usedMinutes: 0,
            limitReached: false,
          };
        case "host.settings.save": {
          const current = {
            maxRunningTasks: 2,
            dailyAgentMinutes: 0,
            ...limits.get(machineId),
            ...(params.settings as object),
          };
          limits.set(machineId, current);
          return { ...current, usedMinutes: 0, limitReached: false };
        }
        case "git.branches": {
          const project = projects[machineId].find((entry) => entry.id === params.projectId)!;
          return {
            current: "main",
            branches: ["main", ...(trees.get(project.id) ?? []).map((tree) => tree.branch)],
            remotes: [],
          };
        }
        case "git.worktrees": {
          const project = projects[machineId].find((entry) => entry.id === params.projectId)!;
          return {
            worktrees: [{ path: project.cwd, branch: "main" }, ...(trees.get(project.id) ?? [])],
          };
        }
        case "git.worktreeCreate": {
          const project = projects[machineId].find((entry) => entry.id === params.projectId)!;
          const tree = { path: `${project.cwd}-integration`, branch: String(params.branch) };
          trees.set(project.id, [...(trees.get(project.id) ?? []), tree]);
          return { ...tree, head: "fixture-commit" };
        }
        case "tasks.start": {
          const task = tasks[machineId].find((entry) => entry.id === params.taskId)!;
          task.status = "running";
          task.sessionId = `worker-${task.id}`;
          return structuredClone(task);
        }
        case "tasks.move": {
          const task = tasks[machineId].find((entry) => entry.id === params.taskId)!;
          const status = params.to as TaskStatus;
          if (!canMoveTask(task.status, status)) throw new Error("Invalid fixture task move");
          task.status = status;
          return structuredClone(task);
        }
        case "tasks.reorder":
          return (params.taskIds as string[]).map((id, position) => {
            const task = tasks[machineId].find((entry) => entry.id === id)!;
            task.position = position;
            return structuredClone(task);
          });
        case "tasks.retarget": {
          const task = tasks[machineId].find((entry) => entry.id === params.taskId)!;
          task.workspace = params.workspace as HostTask["workspace"];
          task.deliveryCwd = task.workspace?.checkoutCwd;
          task.baseBranch = task.workspace?.baseBranch;
          delete task.mergeError;
          return structuredClone(task);
        }
        case "machine.changes": {
          const changes = {
            instanceId: `fixture-${machineId}`,
            reset: !params.instanceId,
            sessions: [],
            projects: [],
            tasks: { etag: `fixture-${tasks[machineId].length}` },
          };
          if (params.waitMs === 0 || params.tasksKnown !== changes.tasks.etag) return changes;
          // A real host keeps an unchanged request pending; it does not emit a
          // busy stream of identical change notifications.
          return new Promise(() => {});
        }
        case "tasks.delete": {
          tasks[machineId] = tasks[machineId].filter((task) => task.id !== params.taskId);
          return null;
        }
        case "tasks.save": {
          const input = params.task as HostTaskInput & {
            status?: "todo" | "queued";
          };
          if (!projects[machineId].some((project) => project.id === input.projectId))
            throw new Error("Task project belongs to another machine");
          const now = Date.now();
          const task: HostTask = {
            ...input,
            status: input.status ?? "queued",
            createdAt: now,
            updatedAt: now,
          };
          tasks[machineId].push(task);
          return structuredClone(task);
        }
        case "goals.create": {
          const input = params.goal as HostGoalInput;
          if (
            !input.projectIds.every((id) =>
              projects[machineId].some((project) => project.id === id),
            )
          )
            throw new Error("Goal project belongs to another machine");
          const now = Date.now();
          const goal: HostGoal = {
            ...input,
            status: "planning",
            taskIds: [],
            createdAt: now,
            updatedAt: now,
          };
          goals[machineId].push(goal);
          return structuredClone(goal);
        }
        default:
          throw new Error(`Unexpected fixture host operation: ${String(args.method)}`);
      }
    },
  },
});
setHarnessModels("claude", [{ id: "claude:fixture", harness: "claude", name: "Demo agent" }]);
saveLastModelChoice("claude", "claude:fixture");
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};
void languageReady
  .then(() => setLanguagePreference(query.get("lang") === "tr" ? "tr" : "en"))
  .then(() =>
    createRoot(document.getElementById("root")!).render(
      <ModelSourceContext.Provider value={source}>
        <div className="flex h-dvh min-h-0 min-w-0 flex-col bg-background-base text-content">
          <TasksView
            besideRail
            cwd={remotePath}
            recents={[
              { path: remotePath, openedAt: 2 },
              { path: localPath, openedAt: 1 },
            ]}
            onClose={() => {}}
            onOpenBackgroundSession={async (target) => {
              openedSessions.push(structuredClone(target));
            }}
          />
        </div>
      </ModelSourceContext.Provider>,
    ),
  );
