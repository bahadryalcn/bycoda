import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TasksView } from "../../src/features/tasks/ui/TasksView";
import type { BackgroundSessionTarget } from "../../src/features/tasks/model/backgroundSession";
import {
  canMoveTask,
  parseHostTask,
  type HostTask,
  type HostTaskInput,
  type TaskStatus,
} from "../../src/features/tasks/model/hostTasks";
import type { HostGoal, HostGoalInput } from "../../src/features/tasks/model/hostGoals";
import {
  requireHostDescriptor,
  type HostProject,
  type RemoteMachine,
} from "../../src/features/connections/model/protocol";
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
  if (query.has("acceptanceEvidence")) {
    const completed = tasks["machine-local"].find((task) => task.id === "review")!;
    const acceptance = [
      "Preserve the saved draft when switching tasks.",
      "Validate the complete flow on a physical Windows installation.",
    ];
    completed.prompt = JSON.stringify({
      schema: "bycoda.task.v1",
      objective: "Preserve drafts through the task workflow.",
      deliverables: ["Draft persistence and its verification record"],
      acceptance,
      constraints: ["Keep existing drafts"],
      verification: ["Run focused draft tests"],
    });
    completed.verification = {
      review: { verdict: "pass", note: "Recorded fixture review", sessionId: "evidence-review" },
      acceptance: {
        checkedAt: Date.UTC(2026, 9, 24, 9, 30),
        sessionId: "evidence-review",
        workspaceFingerprint: "fixture-reviewed-draft-tree",
        criteria: [
          {
            criterionIndex: 0,
            criterion: acceptance[0],
            verdict: "verified",
            evidence: [
              `https://evidence.invalid/${"long-unbroken-reference-".repeat(24)}`,
              "javascript:window.acceptanceEvidenceExecuted=true",
              '<img src="invalid" onerror="window.acceptanceEvidenceExecuted=true">',
            ],
            note: "The focused draft check passed for the recorded working copy.",
          },
          {
            criterionIndex: 1,
            criterion: acceptance[1],
            verdict: "unresolved",
            evidence: [],
            note: "Physical-device acceptance has not been performed.",
          },
        ],
      },
    };
  }
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
  if (query.has("harness")) {
    const completed = tasks["machine-local"].find((task) => task.id === "review")!;
    completed.status = "done";
    completed.completedAt = Date.now() - 1000;
    completed.budgetUsage = {
      historyComplete: true,
      agentMinutes: 3,
      attempts: 4,
      completedRuns: 4,
      runningRuns: 0,
      reportedTokens: 1200,
      tokens: 1200,
      tokensComplete: true,
      unknownTokenRuns: 0,
      reportedCostUsd: 0.12,
      estimatedCostUsd: null,
      measuredAt: Date.now(),
    };
    delete completed.mergeError;
  }
  if (query.has("customReviewer")) {
    const task = tasks["machine-local"].find((entry) => entry.id === "first")!;
    task.review = true;
    task.reviewerConfig = {
      harness: "claude",
      model: "claude:fixture",
      modelSettings: { effort: "high" },
      instructions: "Stored custom reviewer instructions.",
    };
  }
  if (query.has("finalPending") || query.has("finalFailure")) {
    for (const task of tasks["machine-local"]) {
      task.status = "done";
      delete task.mergeError;
    }
    const goal = goals["machine-local"][0];
    goal.finalReview = true;
    goal.status = query.has("finalFailure") ? "blocked" : "running";
    goal.finalAcceptance = {
      status: query.has("finalFailure") ? "failed" : "pending",
      taskFingerprint: "fixture-delivered-result",
      ...(query.has("finalFailure")
        ? { sessionId: "final-review", note: "The integrated user flow still needs verification." }
        : {}),
    };
  }
  if (query.has("uiFilters"))
    tasks["machine-local"].push({
      ...defaults,
      id: "independent",
      title: "Independent task",
      goalId: undefined,
      status: "todo",
      createdAt: 4,
      updatedAt: 4,
    });
}
if (query.has("bulk")) {
  const base = tasks["machine-local"][0];
  tasks["machine-local"] = Array.from({ length: 100 }, (_, index) => ({
    ...base,
    id: `bulk-${index}`,
    title: `Cleanup task ${index}`,
    status: "done",
    goalId: undefined,
    createdAt: index + 1,
    updatedAt: index + 1,
  }));
  tasks["machine-local"].push(
    {
      ...base,
      id: "protected",
      title: "Protected unmerged work",
      status: "review",
      goalId: undefined,
      branch: "mc/protected",
      merged: false,
      createdAt: 101,
      updatedAt: 101,
    },
    {
      ...base,
      id: "active",
      title: "Active work",
      status: "running",
      goalId: undefined,
      createdAt: 102,
      updatedAt: 102,
    },
  );
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
      if (args.method === query.get("slowOperation")) await remoteGate;
      switch (args.method) {
        case "environment.describe":
          return requireHostDescriptor({
            protocolVersion: 1,
            environmentId: machine.environmentId,
            name: machine.name,
            providers: ["claude"],
            platform: machine.localHost ? "win32" : "darwin",
            capabilities: [
              "tasks",
              "tasks.todo",
              "tasks.workspaces",
              "goals.direct-checkout",
              "goals.settings",
              "goals.final-review",
              "tasks.run-budget",
              "tasks.preflight",
              "tasks.evaluation",
              "tasks.reviewer-profile",
              "goals",
              "host.settings",
              "tasks.continue-until-done",
              ...(query.has("changes") ? ["machine.changes"] : []),
            ],
          });
        case "models.list":
          return {
            models: { claude: structuredClone(modelsFor("claude")) },
            errors: {},
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
        case "sessions.get":
          return {
            status: "idle",
            session: {
              title: `Preview ${params.sessionId}`,
              blocks: [
                { id: "owner", role: "user", text: "Please inspect the task" },
                {
                  id: "reply",
                  role: "assistant",
                  text: "Task transcript preview on its original host.",
                },
              ],
            },
          };
        case "tasks.list":
          return structuredClone(tasks[machineId]);
        case "goals.list":
          return structuredClone(goals[machineId]);
        case "tasks.preflight": {
          const input = params.task as HostTaskInput;
          return {
            checkedAt: Date.now(),
            state: "ready",
            items: [
              ...["Host", "Project", "Agent", "Model"].map((label) => ({
                key: label.toLowerCase(),
                label,
                state: "ready",
                required: true,
                checkedAt: Date.now(),
              })),
              ...(input.preflightRequirements ?? []).map((requirement) => ({
                key: JSON.stringify([requirement.kind, requirement.id]),
                label: requirement.id,
                required: requirement.required !== false,
                state: "ready",
                checkedAt: Date.now(),
                detail: "Checked by the in-memory fixture; no external connection was opened.",
              })),
            ],
          };
        }
        case "tasks.evaluation.save": {
          const task = tasks[machineId].find((entry) => entry.id === params.taskId)!;
          if (task.updatedAt !== params.expectedUpdatedAt)
            throw new Error("Task changed before evaluation.");
          task.evaluation = {
            ...(params.evaluation as {
              accepted: boolean;
              reviewMinutes: number;
              corrections: number;
            }),
            recordedAt: Date.now(),
          };
          task.updatedAt++;
          return structuredClone(task);
        }
        case "goals.final-review.recheck": {
          const goal = goals[machineId].find((entry) => entry.id === params.goalId)!;
          if (goal.updatedAt !== params.expectedUpdatedAt)
            throw new Error("Goal changed before recheck.");
          goal.finalAcceptance = { status: "pending", taskFingerprint: "fixture-rechecked-result" };
          goal.status = "running";
          goal.updatedAt++;
          return structuredClone(goal);
        }
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
          if (query.has("bulkFailure") && params.taskId === "bulk-42") {
            query.delete("bulkFailure");
            throw new Error("The machine disconnected during deletion.");
          }
          tasks[machineId] = tasks[machineId].filter((task) => task.id !== params.taskId);
          return null;
        }
        case "tasks.save": {
          const raw = params.task as HostTaskInput & {
            status?: "todo" | "queued";
          };
          const input = parseHostTask(raw);
          if (!projects[machineId].some((project) => project.id === input.projectId))
            throw new Error("Task project belongs to another machine");
          const now = Date.now();
          const previous = tasks[machineId].find((entry) => entry.id === input.id);
          const task: HostTask = {
            ...previous,
            ...input,
            status: previous?.status ?? raw.status ?? "queued",
            createdAt: previous?.createdAt ?? now,
            updatedAt: Math.max(now, (previous?.updatedAt ?? 0) + 1),
          };
          if (previous)
            tasks[machineId] = tasks[machineId].map((entry) =>
              entry.id === task.id ? task : entry,
            );
          else tasks[machineId].push(task);
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
setHarnessModels("claude", [
  {
    id: "claude:fixture",
    harness: "claude",
    name: "Demo agent",
    ...(query.has("harness")
      ? {
          settings: [
            {
              id: "effort",
              label: "Effort",
              kind: "select" as const,
              value: "medium",
              options: [
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ],
            },
          ],
        }
      : {}),
  },
]);
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
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
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
        </ModelSourceContext.Provider>
      </QueryClientProvider>,
    ),
  );
