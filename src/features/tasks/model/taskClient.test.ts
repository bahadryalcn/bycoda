import { describe, expect, it } from "vitest";

it("serializes reusable crews as parent tasks without branch or continuation settings", () => {
  const draft = {
    ...newTaskDraft("G:/app", "codex", "codex:test"),
    title: "Crew task",
    crewDefinitionId: "crew",
    isolate: true,
    autoMerge: true,
    review: true,
  };
  const input = hostTaskFromDraft(draft, "parent", "project");
  expect(input).toMatchObject({ crewDefinitionId: "crew", isolate: false, review: false });
  expect(input.autoMerge).toBeUndefined();
  expect(input.continueUntilDone).toBeUndefined();
  expect(parseHostTask(input)).toMatchObject({ crewDefinitionId: "crew" });
  expect(() => parseHostTask({ ...input, crewRunId: "run" })).toThrow();
  expect(() => parseHostTask({ ...input, isolate: true })).toThrow();
});
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  TASK_AGENT_ERROR,
  boardTaskFromHost,
  boardTasksFromHost,
  draftFromTask,
  formatTaskSpan,
  hostTaskFromDraft,
  newTaskDraft,
  taskMachineFor,
  taskTimeLabel,
  tasksInColumn,
  todoUnsupportedMessage,
} from "./taskClient";
import {
  NO_VERDICT,
  TASK_COLUMNS,
  TASK_STATUSES,
  canEditTask,
  canMoveTask,
  hasUnmergedBranch,
  parseHostTask,
  parseReviewVerdict,
  type HostTask,
} from "./hostTasks";

const mac: RemoteMachine = {
  id: "machine-mac",
  name: "MacBook",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-mac",
  ssh: { target: "me@macbook", remotePort: 3774 },
};
const local: RemoteMachine = {
  id: "machine-local",
  name: LOCAL_SYNC_MACHINE_NAME,
  endpoint: "http://127.0.0.1:3774",
  environmentId: "env-local",
};

const stored: HostTask = {
  id: "main",
  title: "Ship the report",
  prompt: "Write the weekly report",
  projectId: "project-1",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 60,
  status: "running",
  sessionId: "session-1",
  needsInput: true,
  createdAt: 1,
  updatedAt: 2,
  startedAt: 2,
};

describe("task board", () => {
  it("shows a host task on its machine, in its project", () => {
    expect(boardTaskFromHost(mac, "remote://env-mac/Users/me/app", stored)).toEqual({
      ...stored,
      machineId: "machine-mac",
      machineName: "MacBook",
      cwd: "remote://env-mac/Users/me/app",
    });
    expect(boardTaskFromHost(local, "G:/app", stored).machineName).toBe("this computer");
  });

  it("addresses each task by its host project and drops orphaned ones", () => {
    const projects = [{ id: "project-1", cwd: "/Users/me/app", name: "app" }];
    const orphan = { ...stored, id: "orphan", projectId: "gone" };
    expect(boardTasksFromHost(mac, projects, [stored, orphan])).toMatchObject([
      { id: "main", cwd: "remote://env-mac/Users/me/app" },
    ]);
    expect(
      boardTasksFromHost(local, [{ ...projects[0], cwd: "G:/Projects/app" }], [stored])[0].cwd,
    ).toBe("G:/Projects/app");
  });

  it("round-trips a task through the form draft", () => {
    const draft = draftFromTask(boardTaskFromHost(mac, "remote://env-mac/app", stored));
    expect(hostTaskFromDraft(draft, "main", "project-1")).toEqual(parseHostTask(stored));
  });

  it("retains budget, workflow, preparation and independent reviewer settings when editing", () => {
    const task: HostTask = {
      ...stored,
      budget: { maxAgentMinutes: 8, maxAttempts: 6, warningPercent: 80 },
      workflowId: "workflow",
      workflowVersion: 3,
      preflightRequirements: [{ kind: "source", id: "sources/report.md", required: true }],
      reviewerConfig: {
        harness: "codex",
        model: "review",
        modelSettings: { effort: "high" },
        instructions: "Check sources",
      },
    };
    const draft = draftFromTask(boardTaskFromHost(local, "G:/app", task));
    expect(hostTaskFromDraft(draft, task.id, task.projectId)).toMatchObject({
      budget: task.budget,
      workflowId: "workflow",
      workflowVersion: 3,
      preflightRequirements: task.preflightRequirements,
      reviewerConfig: task.reviewerConfig,
    });
  });

  it("serializes an existing reviewer toggle-off as an explicit wire clear", () => {
    const task: HostTask = {
      ...stored,
      reviewerConfig: {
        harness: "codex",
        model: "review",
        modelSettings: { effort: "high" },
        instructions: "Check sources",
      },
    };
    const draft = draftFromTask(boardTaskFromHost(local, "G:/app", task));
    const cleared = hostTaskFromDraft(
      { ...draft, reviewerConfig: undefined },
      task.id,
      task.projectId,
    );
    expect(JSON.parse(JSON.stringify(cleared))).toHaveProperty("reviewerConfig", null);
    expect(
      hostTaskFromDraft(
        { ...newTaskDraft("G:/app", "codex", "codex:test"), reviewerConfig: undefined },
        "new",
        task.projectId,
      ),
    ).not.toHaveProperty("reviewerConfig");
  });

  it("starts a draft with no time limit and refuses agents a host cannot run", () => {
    const draft = newTaskDraft("G:/app", "claude", "claude:test");
    expect(draft).toMatchObject({
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      verifyCommand: "",
      review: false,
      continueUntilDone: true,
    });
    expect(
      hostTaskFromDraft(
        { ...draft, title: "T", isolate: false, verifyCommand: " npm test " },
        "id",
        "project-1",
      ),
    ).toMatchObject({ isolate: false, verifyCommand: "npm test", review: false });
    expect(() =>
      hostTaskFromDraft({ ...draft, harness: "unknown" as never }, "id", "project-1"),
    ).toThrow(TASK_AGENT_ERROR);
  });

  it("pins the selected host and refuses mismatched or disconnected destinations", () => {
    expect(taskMachineFor([mac, local], "G:/app", local.id)).toBe(local);
    expect(taskMachineFor([local, mac], "remote://env-mac/app", mac.id)).toBe(mac);
    expect(() => taskMachineFor([mac, local], "remote://env-mac/app", local.id)).toThrow(
      "Choose a project on the selected machine.",
    );
    expect(() => taskMachineFor([mac], "G:/app", local.id)).toThrow("isn’t connected");
    expect(draftFromTask(boardTaskFromHost(mac, "remote://env-mac/app", stored)).machineId).toBe(
      mac.id,
    );
  });

  it("only offers to-do items on machines whose host advertises them", () => {
    const machines = [mac, local];
    expect(todoUnsupportedMessage(machines, [local], "G:/app")).toBeUndefined();
    expect(todoUnsupportedMessage(machines, [], "G:/app")).toBe(
      "Update bycoda Host on this computer to add to-do items",
    );
    expect(todoUnsupportedMessage(machines, [local], "remote://env-mac/Users/me/app")).toBe(
      "Update bycoda Host on MacBook to add to-do items",
    );
    // No machine at all has its own message.
    expect(todoUnsupportedMessage([], [], "G:/app")).toBeUndefined();
  });

  it("lists to-do items first, oldest first, and times them from creation", () => {
    const board = [
      { ...stored, id: "b", status: "todo" as const, createdAt: 2 },
      { ...stored, id: "a", status: "todo" as const, createdAt: 1 },
    ].map((task) => boardTaskFromHost(mac, "remote://env-mac/app", task));
    expect(tasksInColumn(board, "todo").map((task) => task.id)).toEqual(["a", "b"]);
    expect(taskTimeLabel({ status: "todo", createdAt: 0, updatedAt: 0 }, 5 * 60_000)).toBe(
      "Added 5m ago",
    );
  });

  it("orders waiting columns oldest first and finished ones newest first", () => {
    const board = [
      { ...stored, id: "b", status: "queued" as const, createdAt: 2 },
      { ...stored, id: "a", status: "queued" as const, createdAt: 1 },
      { ...stored, id: "old", status: "done" as const, completedAt: 5 },
      { ...stored, id: "new", status: "done" as const, completedAt: 9 },
    ].map((task) => boardTaskFromHost(mac, "remote://env-mac/app", task));
    expect(tasksInColumn(board, "queued").map((task) => task.id)).toEqual(["a", "b"]);
    expect(tasksInColumn(board, "done").map((task) => task.id)).toEqual(["new", "old"]);
    expect(tasksInColumn(board, "blocked")).toEqual([]);
  });

  it("shows a task being verified in the running column", () => {
    const board = [
      { ...stored, id: "checking", status: "verifying" as const, createdAt: 2 },
      { ...stored, id: "working", createdAt: 1 },
    ].map((task) => boardTaskFromHost(mac, "remote://env-mac/app", task));
    expect(tasksInColumn(board, "running").map((task) => task.id)).toEqual(["working", "checking"]);
    expect(TASK_COLUMNS).not.toContain("verifying");
    expect(
      taskTimeLabel({ status: "verifying", createdAt: 0, updatedAt: 60_000 }, 4 * 60_000),
    ).toBe("Verifying 3m");
  });

  it("says how long a task has waited, run, or been finished", () => {
    const minute = 60_000;
    expect(formatTaskSpan(-5)).toBe("under 1m");
    expect(formatTaskSpan(59 * minute)).toBe("59m");
    expect(formatTaskSpan(120 * minute)).toBe("2h");
    expect(formatTaskSpan(185 * minute)).toBe("3h 5m");
    expect(formatTaskSpan(52 * 60 * minute)).toBe("2d 4h");
    const base = { createdAt: 0, updatedAt: 0 };
    const now = 30 * minute;
    expect(taskTimeLabel({ ...base, status: "queued" }, now)).toBe("Waiting 30m");
    expect(taskTimeLabel({ ...base, status: "running", startedAt: 18 * minute }, now)).toBe(
      "Running 12m",
    );
    expect(taskTimeLabel({ ...base, status: "review", completedAt: 25 * minute }, now)).toBe(
      "Finished 5m ago",
    );
    expect(taskTimeLabel({ ...base, status: "blocked", completedAt: 29 * minute }, now)).toBe(
      "Stopped 1m ago",
    );
  });
});

describe("host task rules", () => {
  it("keeps crew completion out of board moves while preserving retry and stop", () => {
    expect(canMoveTask("review", "done", "crew-run")).toBe(false);
    expect(canMoveTask("todo", "done", "crew-run")).toBe(false);
    expect(canMoveTask("review", "queued", "crew-run")).toBe(true);
    expect(canMoveTask("running", "blocked", "crew-run")).toBe(true);
    expect(canMoveTask("review", "done")).toBe(true);
  });
  it("allows exactly the moves the board offers", () => {
    const allowed = TASK_STATUSES.flatMap((from) =>
      TASK_STATUSES.filter((to) => canMoveTask(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed).toEqual([
      "todo>queued",
      "todo>done",
      "queued>todo",
      "running>blocked",
      "verifying>blocked",
      "review>queued",
      "review>done",
      "done>todo",
      "done>queued",
      "blocked>todo",
      "blocked>queued",
    ]);
    expect(TASK_STATUSES.filter(canEditTask)).toEqual(["todo", "queued", "blocked"]);
    expect(TASK_COLUMNS[0]).toBe("todo");
  });

  it("validates a task and reports what is wrong", () => {
    const { status, sessionId, needsInput, createdAt, updatedAt, startedAt, ...input } = stored;
    expect(parseHostTask({ ...input, title: "  Ship  " })).toEqual({
      ...input,
      title: "Ship",
      // A task runs on its own branch and is reviewed unless it says otherwise.
      isolate: true,
      review: true,
    });
    expect(
      parseHostTask({
        ...input,
        isolate: false,
        review: false,
        verifyCommand: " npm test ",
      }),
    ).toMatchObject({ isolate: false, review: false, verifyCommand: "npm test" });
    expect(parseHostTask({ ...input, verifyCommand: "  " })).not.toHaveProperty("verifyCommand");
    expect(() => parseHostTask({ ...input, isolate: "yes" })).toThrow("Invalid task options");
    expect(() => parseHostTask({ ...input, verifyCommand: 5 })).toThrow("Invalid check command");
    expect(parseHostTask({ ...input, maxRunMinutes: undefined }).maxRunMinutes).toBe(0);
    expect(() => parseHostTask(null)).toThrow("Invalid task");
    expect(() => parseHostTask({ ...input, id: "bad id" })).toThrow("Invalid task ID");
    expect(() => parseHostTask({ ...input, title: " " })).toThrow("Task title is required");
    // A to-do item may have no description; the host checks before starting.
    expect(parseHostTask({ ...input, prompt: "" }).prompt).toBe("");
    expect(() => parseHostTask({ ...input, prompt: 5 })).toThrow("Invalid task description.");
    expect(() => parseHostTask({ ...input, projectId: "" })).toThrow(
      "Choose a project for this task.",
    );
    expect(() => parseHostTask({ ...input, harness: "unknown" })).toThrow("Invalid task agent");
    expect(() => parseHostTask({ ...input, runtimeMode: "root" })).toThrow(
      "Invalid task run mode.",
    );
    expect(() => parseHostTask({ ...input, maxRunMinutes: -1 })).toThrow("Invalid task run limit");
  });

  it("reads the reviewer's verdict from the last line of its reply", () => {
    expect(parseReviewVerdict("All good.\n\nVERDICT: PASS")).toEqual({
      verdict: "pass",
      note: "",
    });
    expect(parseReviewVerdict("**VERDICT: FAIL - Tests are missing.**\n")).toEqual({
      verdict: "fail",
      note: "Tests are missing.",
    });
    expect(parseReviewVerdict("VERDICT: FAIL")).toEqual({
      verdict: "fail",
      note: "The reviewer gave no reason.",
    });
    // Only the final line counts.
    expect(parseReviewVerdict("VERDICT: PASS\nActually, one more thing.")).toEqual({
      verdict: "fail",
      note: NO_VERDICT,
    });
    expect(parseReviewVerdict("")).toEqual({ verdict: "fail", note: NO_VERDICT });
    expect(hasUnmergedBranch({ branch: "mc/abcd1234" })).toBe(true);
    expect(hasUnmergedBranch({ branch: "mc/abcd1234", merged: true })).toBe(false);
    expect(hasUnmergedBranch({})).toBe(false);
  });
});

describe("missing machines notice", () => {
  it("is empty when every machine answered", async () => {
    const { missingMachinesNotice } = await import("./taskClient");
    expect(missingMachinesNotice({ outdated: [], unreachable: [] })).toBeNull();
  });

  it("names offline machines and machines with an older host", async () => {
    const { missingMachinesNotice } = await import("./taskClient");
    expect(missingMachinesNotice({ outdated: [], unreachable: ["MacBook"] })).toBe(
      "MacBook isn’t reachable right now, so its tasks aren’t shown.",
    );
    expect(
      missingMachinesNotice({
        outdated: ["this computer"],
        unreachable: ["MacBook", "Mini"],
      }),
    ).toBe(
      "MacBook, Mini aren’t reachable right now, so their tasks aren’t shown. Update bycoda Host on this computer to see its tasks.",
    );
  });
});

describe("merging automatically in the task draft", () => {
  it("sends autoMerge only when asked for and the task has its own branch", () => {
    const draft = {
      ...newTaskDraft("G:/app", "claude", "claude:test"),
      title: "T",
    };
    expect(draft.autoMerge).toBe(false);
    expect(hostTaskFromDraft(draft, "id", "project-1").autoMerge).toBeUndefined();
    expect(
      hostTaskFromDraft({ ...draft, isolate: true, autoMerge: true }, "id", "project-1"),
    ).toMatchObject({
      isolate: true,
      autoMerge: true,
    });
    expect(
      hostTaskFromDraft({ ...draft, autoMerge: true, isolate: false }, "id", "project-1").autoMerge,
    ).toBeUndefined();
  });

  it("starts an edit from the task's own setting", () => {
    const task = boardTaskFromHost(mac, "remote://env-mac/app", {
      ...stored,
      autoMerge: true,
    });
    expect(draftFromTask(task).autoMerge).toBe(true);
    expect(draftFromTask({ ...task, autoMerge: undefined }).autoMerge).toBe(false);
  });
});
