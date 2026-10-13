import { describe, expect, it } from "vitest";
import type { Automation } from "../../automations/model/automations";
import type { BoardGoal } from "./goalClient";
import type { BoardTask } from "./taskClient";
import {
  backgroundSnapshot,
  backgroundTransitions,
  carryForward,
  emptyBackgroundSnapshot,
} from "./taskTransitions";

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  id: "main",
  title: "Ship the report",
  prompt: "Write the weekly report",
  projectId: "project-1",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "running",
  createdAt: 1,
  updatedAt: 1,
  machineId: "machine-mac",
  machineName: "MacBook",
  cwd: "remote://env-mac/app",
  ...overrides,
});

const goal = (overrides: Partial<BoardGoal> = {}): BoardGoal => ({
  id: "launch",
  title: "Launch the beta",
  prompt: "Ship the beta",
  projectIds: ["project-1"],
  leadProjectId: "project-1",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  verifyDefaults: { review: true },
  approvePlan: false,
  status: "planning",
  taskIds: [],
  createdAt: 1,
  updatedAt: 1,
  machineId: "machine-mac",
  machineName: "MacBook",
  projects: [],
  ...overrides,
});

const automation = (overrides: Partial<Automation> = {}, needsInput = false): Automation =>
  ({
    id: "nightly",
    name: "Nightly audit",
    lastRunStatus: "succeeded",
    lastRunAt: 10,
    host: {
      machineId: "machine-mac",
      machineName: "MacBook",
      projectId: "project-1",
      ...(needsInput ? { needsInput: true } : {}),
    },
    ...overrides,
  }) as Automation;

const messages = (
  before: { tasks?: BoardTask[]; automations?: Automation[] },
  after: { tasks?: BoardTask[]; automations?: Automation[] },
) =>
  backgroundTransitions(
    backgroundSnapshot(before.tasks ?? [], before.automations ?? []),
    backgroundSnapshot(after.tasks ?? [], after.automations ?? []),
  ).map(({ target, kind, message }) => `${target}/${kind}: ${message}`);

describe("background transitions", () => {
  it("announces a task reaching review, getting blocked or waiting", () => {
    expect(messages({ tasks: [task()] }, { tasks: [task({ status: "review" })] })).toEqual([
      "tasks/finished: Ready for review: Ship the report on MacBook",
    ]);
    expect(
      messages(
        { tasks: [task()] },
        { tasks: [task({ status: "blocked", error: "Tests failed" })] },
      ),
    ).toEqual(["tasks/failed: Blocked: Ship the report — Tests failed"]);
    expect(messages({ tasks: [task()] }, { tasks: [task({ needsInput: true })] })).toEqual([
      "tasks/input: Waiting for you: Ship the report",
    ]);
  });

  it("stays quiet when nothing changed, or a task leaves those states", () => {
    const review = task({ status: "review" });
    expect(messages({ tasks: [review] }, { tasks: [review] })).toEqual([]);
    expect(
      messages({ tasks: [task({ needsInput: true })] }, { tasks: [task({ needsInput: false })] }),
    ).toEqual([]);
    expect(messages({ tasks: [review] }, { tasks: [task({ status: "done" })] })).toEqual([]);
  });

  it("never announces a task entering to do", () => {
    for (const status of ["review", "blocked", "done", "queued"] as const)
      expect(
        messages(
          { tasks: [task({ status })] },
          { tasks: [task({ status: "todo", needsInput: true, error: "x" })] },
        ),
      ).toEqual([]);
  });

  it("does not announce what it had not seen before", () => {
    expect(
      backgroundTransitions(
        emptyBackgroundSnapshot(),
        backgroundSnapshot(
          [task({ status: "review" }), task({ id: "b", needsInput: true })],
          [automation({ lastRunStatus: "failed" }, true)],
        ),
      ),
    ).toEqual([]);
  });

  it("announces a failed run and a waiting run of an automation", () => {
    expect(
      messages(
        { automations: [automation()] },
        {
          automations: [
            automation({
              lastRunStatus: "failed",
              lastRunError: "Timed out",
              lastRunAt: 20,
            }),
          ],
        },
      ),
    ).toEqual(["automations/failed: Automation failed: Nightly audit — Timed out"]);
    // A second failure in a row is a new run.
    const failed = automation({ lastRunStatus: "failed", lastRunAt: 20 });
    expect(
      messages({ automations: [failed] }, { automations: [{ ...failed, lastRunAt: 30 }] }),
    ).toEqual(["automations/failed: Automation failed: Nightly audit"]);
    expect(messages({ automations: [failed] }, { automations: [failed] })).toEqual([]);
    expect(
      messages({ automations: [automation()] }, { automations: [automation({}, true)] }),
    ).toEqual(["automations/input: Waiting for you: Nightly audit"]);
  });

  it("leaves out automations this app runs itself", () => {
    expect(backgroundSnapshot([], [automation({ host: undefined })]).automations.size).toBe(0);
  });

  it("announces a plan ready for approval, a blocked goal and a done goal", () => {
    const goals = (before: Partial<BoardGoal>, after: Partial<BoardGoal>) =>
      backgroundTransitions(
        backgroundSnapshot([], [], [goal(before)]),
        backgroundSnapshot([], [], [goal(after)]),
      ).map(({ target, kind, message }) => `${target}/${kind}: ${message}`);
    expect(goals({}, { status: "awaiting-approval" })).toEqual([
      "tasks/input: Plan ready: Launch the beta",
    ]);
    expect(goals({}, { status: "blocked", planError: "The plan has no tasks." })).toEqual([
      "tasks/failed: Goal blocked: Launch the beta — The plan has no tasks.",
    ]);
    expect(
      goals({ status: "running" }, { status: "blocked", error: "1 of 2 tasks blocked: Do a" }),
    ).toEqual(["tasks/failed: Goal blocked: Launch the beta — 1 of 2 tasks blocked: Do a"]);
    expect(goals({ status: "running" }, { status: "done" })).toEqual([
      "tasks/finished: Goal done: Launch the beta",
    ]);
    // Nothing for planning, running, cancelled, or no change.
    expect(goals({}, { status: "running" })).toEqual([]);
    expect(goals({ status: "running" }, { status: "cancelled" })).toEqual([]);
    expect(goals({ status: "done" }, { status: "done" })).toEqual([]);
    // A goal not seen before only counts once it changes.
    expect(
      backgroundTransitions(
        emptyBackgroundSnapshot(),
        backgroundSnapshot([], [], [goal({ status: "done" })]),
      ),
    ).toEqual([]);
  });

  it("keeps the last state of a machine that did not answer", () => {
    const first = backgroundSnapshot([task()], []);
    const missed = carryForward(first, emptyBackgroundSnapshot());
    expect(missed.tasks.size).toBe(1);
    const back = carryForward(missed, backgroundSnapshot([task({ status: "review" })], []));
    expect(backgroundTransitions(missed, back)).toMatchObject([
      { target: "tasks", kind: "finished" },
    ]);
  });
});

describe("automatic merges", () => {
  it("announces a task merged on its own once, and not as ready for review", () => {
    expect(
      messages(
        { tasks: [task({ status: "verifying" })] },
        { tasks: [task({ status: "done", merged: true, autoMerged: true })] },
      ),
    ).toEqual(["tasks/finished: Merged automatically: Ship the report on MacBook"]);
    const merged = task({ status: "done", merged: true, autoMerged: true });
    expect(messages({ tasks: [merged] }, { tasks: [merged] })).toEqual([]);
  });

  it("still announces review when the merge did not happen, and stays quiet for an approved one", () => {
    expect(
      messages(
        { tasks: [task({ status: "verifying" })] },
        {
          tasks: [
            task({
              status: "review",
              mergeError: "The project has uncommitted changes.",
            }),
          ],
        },
      ),
    ).toEqual(["tasks/finished: Ready for review: Ship the report on MacBook"]);
    expect(
      messages(
        { tasks: [task({ status: "review" })] },
        { tasks: [task({ status: "done", merged: true })] },
      ),
    ).toEqual([]);
  });
});
