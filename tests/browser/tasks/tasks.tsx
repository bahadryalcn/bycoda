import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TasksView } from "../../../src/features/tasks/ui/TasksView";
import { SprintFixture } from "./sprintFixture";
import type { BackgroundSessionTarget } from "../../../src/features/tasks/model/backgroundSession";
import {
  canMoveTask,
  parseHostTask,
  type HostTask,
  type HostTaskInput,
  type TaskStatus,
} from "../../../src/features/tasks/model/hostTasks";
import type { HostGoal, HostGoalInput } from "../../../src/features/tasks/model/hostGoals";
import {
  requireHostDescriptor,
  type HostProject,
  type RemoteMachine,
} from "../../../src/features/connections/model/protocol";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  saveLastModelChoice,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { languageReady, setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";
import type { ManagedWorkspace } from "../../../src/features/workspaces/model/contracts";

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
// ?sprintSeed is ?sprints with a history: two completed sprints, an active one and a planned one.
const seedSprints = query.has("sprintSeed");
const sprintFixture =
  query.has("sprints") || seedSprints ? new SprintFixture(machines, () => tasks) : null;
if (sprintFixture) {
  const demo = (
    id: string,
    projectId: string,
    title: string,
    status: TaskStatus = "todo",
  ): HostTask => ({
    id,
    projectId,
    title,
    prompt: `Synthetic sprint instructions for ${title}`,
    harness: "claude",
    model: "claude:fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  tasks["machine-local"] = [
    demo("local-task", "local-project", "PC onboarding"),
    demo("docs-task", "local-docs", "Documentation cleanup"),
  ];
  tasks["machine-remote"] = [
    demo("remote-task", "remote-project", "MacBook checkout"),
    demo("remote-done", "remote-project", "MacBook shipped task", "done"),
    demo("api-task", "remote-api", "API stability"),
  ];
  if (seedSprints) {
    const longTitle =
      "Audit every keyboard shortcut across the editor, the terminal and the dialogs, then document conflicts for the whole team";
    const rows: [string, string, string, string, TaskStatus][] = [
      ["machine-local", "task-settings", "local-project", "Settings migration", "done"],
      ["machine-local", "task-shortcuts", "local-project", longTitle, "done"],
      ["machine-local", "task-resume", "local-project", "Crash on resume", "done"],
      ["machine-local", "task-onboarding", "local-project", "PC onboarding", "running"],
      ["machine-local", "task-docs", "local-docs", "Documentation cleanup", "done"],
      ["machine-local", "task-notes", "local-docs", "Release notes draft", "todo"],
      ["machine-remote", "task-keys", "remote-project", "Signing keys rotation", "done"],
      ["machine-remote", "task-shipped", "remote-project", "MacBook shipped task", "done"],
      ["machine-remote", "task-checkout", "remote-project", "MacBook checkout", "todo"],
      ["machine-remote", "task-next", "remote-project", "Planned for the next sprint", "todo"],
      ["machine-remote", "task-api", "remote-api", "API stability", "running"],
      ["machine-remote", "task-headers", "remote-api", "Rate limit headers", "done"],
      ["machine-remote", "task-idea", "remote-api", "Backlog idea without a sprint", "todo"],
    ];
    tasks["machine-local"] = [];
    tasks["machine-remote"] = [];
    for (const [machineId, id, projectId, title, status] of rows)
      tasks[machineId].push(demo(id, projectId, title, status));
    // A long description exercises wrapping in the detail panel and the edit form.
    tasks["machine-remote"].find((task) => task.id === "task-checkout")!.prompt = Array.from(
      { length: 12 },
      (_, index) =>
        `Step ${index + 1}: read the rate limiter, compare it with the documented limits and write down every header a client can rely on, including the ones that only appear on retries.`,
    ).join("\n\n");
  }
}
const trees = new Map<string, { path: string; branch: string }[]>();
const managedWorkspace: ManagedWorkspace = {
  id: "managed-task-workspace",
  repositoryId: "fixture-repo",
  projectId: "local-project",
  environmentId: "env-local",
  owner: { kind: "task", id: "managed-task" },
  path: "C:/fixture/worktrees/wt-aabbccddeeff",
  branchRef: "refs/heads/bycoda/t/managed-aabbccddeeff",
  baseRef: "refs/heads/main",
  baseCommit: "abc123",
  targetBranchRef: "refs/heads/main",
  state: "idle",
  directoryState: "present",
  revision: 3,
  lastActivityAt: Date.now(),
  pinned: false,
};
if (query.has("managedDelivery"))
  tasks["machine-local"] = [
    {
      id: "managed-task",
      title: "Finished implementation awaiting delivery",
      prompt: "Keep completion separate from integration approval.",
      projectId: "local-project",
      harness: "claude",
      model: "claude:fixture",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      status: "review",
      branch: "bycoda/t/managed-aabbccddeeff",
      baseBranch: "main",
      autoMerge: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspaceId: managedWorkspace.id,
      finalization: {
        branch: managedWorkspace.branchRef.replace(/^refs\/heads\//, ""),
        head: "b".repeat(40),
        status: "",
        diff: "",
        fingerprint: "managed-task-finished",
        clean: true,
      },
      deliveryState: "awaitingOwner" as const,
      deliveryApprovalRequired: true,
    },
  ];
// ?autonomy: one task per owner-facing status line (fixture data only).
if (query.has("autonomy")) {
  const at = Date.now();
  const base = {
    prompt: "Fixture instructions",
    projectId: "local-project",
    harness: "claude",
    model: "claude:fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    createdAt: at - 3_600_000,
    updatedAt: at,
  } as const;
  tasks["machine-local"] = [
    {
      ...base,
      id: "auto-correcting",
      title: "Fix flaky playback test",
      status: "running",
      startedAt: at - 600_000,
      repairAttempts: 2,
      repairNote: "The seek test still fails on resume. It expects 4 seconds but gets 0.",
    },
    {
      ...base,
      id: "auto-verifying",
      title: "Add export button",
      status: "verifying",
      startedAt: at - 300_000,
    },
    {
      ...base,
      id: "auto-notes",
      title: "Localize onboarding screens",
      status: "review",
      startedAt: at - 3_000_000,
      completedAt: at - 60_000,
      completedWithFindings: true,
      diffStat:
        " src/onboarding.tsx | 40 ++++---\n src/i18n/tr.json | 12 +++\n 2 files changed, 44 insertions(+), 8 deletions(-)",
      ownerNotices: [
        {
          id: "n1",
          kind: "remaining_finding",
          message: "The Japanese welcome title still wraps on narrow screens.",
          at,
        },
        {
          id: "n2",
          kind: "external_check",
          message: "Check the onboarding flow on a physical iPhone.",
          at,
        },
        {
          id: "n3",
          kind: "auto_continued",
          message: "The run limit was reached once and the task continued automatically.",
          at,
        },
      ],
      attemptHistory: [
        {
          attempt: 0,
          at: at - 1_200_000,
          reviewerSessionId: "auto-review-1",
          workerSessionId: "auto-worker-1",
          workerSummary:
            "## Changes\n- Moved onboarding copy into the shared catalog.\n- Added Turkish and Japanese translations for all **12** strings.\n- Updated the welcome layout to wrap long titles.\n\n## Checks\n- `pnpm typecheck` passed.\n- Focused onboarding tests passed.",
          verdict: "fail",
          note: "The Japanese welcome title wraps badly at 320 px. Everything else matches the acceptance criteria, including the Turkish copy review and the catalog check.",
          findings: ["Japanese title wraps"],
        },
      ],
    },
    {
      ...base,
      id: "auto-budget",
      title: "Refactor billing module",
      status: "blocked",
      completedAt: at - 120_000,
      budgetStop: "Agent minutes reached 30 of 30.",
      awaitingOwnerRestart: true,
      error: "Run budget: Agent minutes reached 30 of 30.",
    },
    {
      ...base,
      id: "auto-failed",
      title: "Upgrade database driver",
      status: "blocked",
      completedAt: at - 200_000,
      continueUntilDone: true,
      error:
        "The provider disconnected while applying the migration and the session could not be resumed after three reconnect attempts; inspect the migration log under temp/db before retrying.",
    },
    {
      ...base,
      id: "auto-external",
      title: "Verify TalkBack reset",
      status: "blocked",
      completedAt: at - 400_000,
      continueUntilDone: true,
      repairStop: {
        reason: "external",
        message:
          "Provide an Android device to test TalkBack reset. The emulator does not expose the gesture.",
      },
      error: "Review failed: TalkBack reset was not verified.",
    },
  ];
}
const limits = new Map<string, { maxRunningTasks: number; dailyAgentMinutes: number }>();
if (query.has("stalled")) {
  const at = Date.now();
  tasks["machine-local"] = [
    {
      id: "stalled-task",
      title: "Inspect delayed worker",
      prompt: "Fixture only, no live work",
      projectId: "local-project",
      harness: "claude",
      model: "claude:fixture",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      status: "running",
      sessionId: "worker-stalled",
      runId: "run-stalled",
      createdAt: at - 3600_000,
      updatedAt: at,
      startedAt: at - 3600_000,
      ...(query.has("cleared")
        ? {}
        : {
            runStall: {
              sessionId: "worker-stalled",
              runId: "run-stalled",
              lastActivityAt: at - 16 * 60_000,
              detectedAt: at,
            },
          }),
    },
  ];
}
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
      autoMerge: query.has("renewedApprovalSettings"),
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
  taskFixtureSprints: sprintFixture,
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
      if (command === "local_host_connect")
        return machines.find((machine) => machine.localHost) ?? null;
      if (command === "plugin:event|listen") return 1;
      if (command !== "remote_request") return null;
      const machineId = String(args.machineId);
      const machine = machines.find((entry) => entry.id === machineId);
      if (!machine) throw new Error("Unknown fixture machine");
      const params = (args.params ?? {}) as Record<string, unknown>;
      if (machineId === "machine-remote" && args.method === slowRemoteMethod) await remoteGate;
      if (args.method === query.get("slowOperation")) await remoteGate;
      if (
        sprintFixture &&
        (String(args.method).startsWith("sprints.") ||
          args.method === "tasks.snapshotWithCursor" ||
          args.method === "tasks.events")
      )
        return sprintFixture.rpc(String(args.method), machineId, params);
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
              ...(query.has("suspendedForms") ? ["stewards"] : []),
              ...(query.has("managedDelivery")
                ? ["workspaces.managed.v1", "workspaces.delivery.v1"]
                : []),
              "tasks.todo",
              ...(sprintFixture ? ["tasks.sprints.v1", "tasks.history.v1"] : []),
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
        case "stewards.list":
          return [];
        case "workspaces.get":
          return structuredClone(managedWorkspace);
        case "workspaces.finish": {
          if (params.expectedRevision !== managedWorkspace.revision)
            throw new Error("Workspace changed. Review it again.");
          managedWorkspace.state = "finished";
          managedWorkspace.revision++;
          tasks["machine-local"][0].status = "done";
          return structuredClone(managedWorkspace);
        }
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

/** Builds the sprint history through the fixture's own commands, moving the clock
 * back so the reports have days of work behind them. Fictitious data only. */
async function seedSprintHistory() {
  if (!sprintFixture || !seedSprints) return;
  const day = 86_400_000;
  const realNow = Date.now.bind(Date);
  const base = realNow();
  let clock = base;
  Date.now = () => clock;
  const envOf = (machineId: string) =>
    machines.find((entry) => entry.id === machineId)!.environmentId;
  const place: Record<string, string> = {};
  for (const [machineId, list] of Object.entries(tasks))
    for (const task of list) place[task.id] = machineId;
  const statuses = new Map<string, TaskStatus>();
  const finalStatus = new Map<string, TaskStatus>();
  for (const list of Object.values(tasks))
    for (const task of list) {
      finalStatus.set(task.id, task.status);
      statuses.set(task.id, "todo");
    }
  let cursor = 0;
  const ingest = async () => {
    cursor++;
    for (const [machineId, list] of Object.entries(tasks)) {
      const environmentId = envOf(machineId);
      await sprintFixture.rpc("sprints.ingest", machineId, {
        input: {
          environmentId,
          cursor,
          caughtUp: true,
          visibleProjectIds: [...new Set(list.map((task) => task.projectId))],
          snapshot: {
            cursor,
            historyAvailableFrom: base - 40 * day,
            tasks: list.map((task) => ({
              id: task.id,
              projectId: task.projectId,
              title: task.title,
              status: statuses.get(task.id)!,
              updatedAt: clock,
            })),
          },
        },
      });
    }
  };
  const ref = (taskId: string) => {
    const task = Object.values(tasks)
      .flat()
      .find((entry) => entry.id === taskId)!;
    const machineId = place[taskId];
    return { environmentId: envOf(machineId), projectId: task.projectId, taskId };
  };
  const project = (machineId: string, projectId: string) => {
    const match = projects[machineId].find((entry) => entry.id === projectId)!;
    return {
      environmentId: envOf(machineId),
      projectId,
      name: match.name,
      cwd: machineId === "machine-remote" ? `remote://env-remote${match.cwd}` : match.cwd,
    };
  };
  const call = (method: string, id: string, input: Record<string, unknown>) =>
    sprintFixture.rpc(method, "machine-local", {
      id,
      input: { requestId: crypto.randomUUID(), ...input },
    });
  const sprint = async (
    id: string,
    name: string,
    goal: string,
    capacity: number,
    startDay: number,
    endDay: number,
    scope: [string, number | null][],
    projectRefs: ReturnType<typeof project>[],
  ) => {
    clock = base + startDay * day;
    await call("sprints.create", id, {
      id,
      name,
      goal,
      projects: projectRefs,
      capacityPoints: capacity,
      projectCapacities: {},
      startsAt: clock,
      endsAt: base + endDay * day,
    });
    for (const [taskId, storyPoints] of scope)
      await call("sprints.plan", id, {
        ...ref(taskId),
        sprintId: id,
        storyPoints,
        expectedRevision: 0,
      });
  };
  const finish = async (taskId: string, onDay: number, status: TaskStatus = "done") => {
    clock = base + onDay * day;
    statuses.set(taskId, status);
    await ingest();
  };
  const all = [
    project("machine-local", "local-project"),
    project("machine-local", "local-docs"),
    project("machine-remote", "remote-project"),
    project("machine-remote", "remote-api"),
  ];
  clock = base - 36 * day;
  await ingest();
  await sprint(
    "sprint-41",
    "Sprint 41",
    "Settings and signing keys.",
    13,
    -35,
    -22,
    [
      ["task-settings", 3],
      ["task-shortcuts", 5],
      ["task-keys", 2],
    ],
    [all[0], all[2]],
  );
  await call("sprints.start", "sprint-41", { expectedRevision: 1 });
  await finish("task-settings", -32);
  await finish("task-keys", -28);
  await finish("task-shortcuts", -24);
  clock = base - 22 * day;
  await call("sprints.complete", "sprint-41", { expectedRevision: 2 });
  await sprint(
    "sprint-42",
    "Sprint 42",
    "Resume reliability and rate limits.",
    16,
    -21,
    -7,
    [
      ["task-resume", 5],
      ["task-shipped", 8],
      ["task-headers", 3],
    ],
    all,
  );
  await call("sprints.start", "sprint-42", { expectedRevision: 1 });
  await finish("task-headers", -17);
  await finish("task-resume", -12);
  await finish("task-shipped", -8);
  clock = base - 7 * day;
  await call("sprints.complete", "sprint-42", { expectedRevision: 2 });
  await sprint(
    "sprint-43",
    "Sprint 43",
    "Ship onboarding and keep the API stable. This goal is intentionally long so the heading, the report and the sprint list all have to cope with a sentence that keeps going past one line.",
    21,
    -6,
    8,
    [
      ["task-onboarding", 3],
      ["task-docs", 2],
      ["task-notes", null],
      ["task-checkout", 5],
      ["task-api", 8],
    ],
    all,
  );
  await call("sprints.start", "sprint-43", { expectedRevision: 1 });
  await finish("task-docs", -5);
  await finish("task-onboarding", -3, "running");
  await finish("task-api", -2, "running");
  await sprint("sprint-44", "Sprint 44", "", 8, 8, 22, [["task-next", 5]], [all[2]]);
  Date.now = realNow;
  for (const [id, status] of finalStatus) statuses.set(id, status);
}
void languageReady
  .then(() => seedSprintHistory())
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
