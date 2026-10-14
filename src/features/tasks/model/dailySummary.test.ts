import { describe, expect, it } from "vitest";
import { buildDailySummary, summaryHeadline, type DailySummaryInput } from "./dailySummary";
import type { BoardGoal } from "./goalClient";
import type { BoardTask } from "./taskClient";

const SINCE = 1_000;
const NOW = 2_000;

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  id: "t1",
  title: "Task",
  prompt: "",
  projectId: "p",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "todo",
  createdAt: 1,
  updatedAt: 1,
  machineId: "m1",
  machineName: "this computer",
  cwd: "/work/project",
  ...overrides,
});

const goal = (overrides: Partial<BoardGoal> = {}): BoardGoal => ({
  id: "g1",
  title: "Goal",
  prompt: "",
  projectIds: ["p"],
  leadProjectId: "p",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  verifyDefaults: { review: true },
  approvePlan: false,
  status: "running",
  taskIds: [],
  createdAt: 1,
  updatedAt: 1,
  machineId: "m1",
  machineName: "this computer",
  projects: [],
  ...overrides,
});

const build = (input: Partial<DailySummaryInput> = {}) =>
  buildDailySummary({
    since: SINCE,
    now: NOW,
    tasks: [],
    goals: [],
    usageByMachine: [],
    unreachable: [],
    outdated: [],
    ...input,
  });

describe("buildDailySummary", () => {
  it("lists tasks done in the period with project and machine, counting auto-merges", () => {
    const summary = build({
      tasks: [
        task({ id: "a", title: "A", status: "done", completedAt: 1500, autoMerged: true }),
        task({ id: "b", title: "B", status: "done", completedAt: 1800, machineName: "MacBook" }),
        task({ id: "c", title: "Old", status: "done", completedAt: 500 }),
      ],
    });
    expect(summary.finished.map((entry) => entry.title)).toEqual(["A", "B"]);
    expect(summary.finished[1]).toMatchObject({
      project: "project",
      machineName: "MacBook",
      key: "m1:b",
    });
    expect(summary.autoMerged).toBe(1);
  });

  it("dates a finished task by completedAt, else updatedAt, with an exclusive start", () => {
    const summary = build({
      tasks: [
        task({ id: "edge", status: "done", completedAt: SINCE }),
        task({ id: "end", status: "done", completedAt: NOW }),
        task({ id: "late", status: "done", completedAt: NOW + 1 }),
        task({ id: "upd", status: "done", updatedAt: 1500 }),
      ],
    });
    expect(summary.finished.map((entry) => entry.key)).toEqual(["m1:end", "m1:upd"]);
  });

  it("lists blocked tasks changed in the period with the first line of the error", () => {
    const summary = build({
      tasks: [
        task({ id: "x", status: "blocked", updatedAt: 1500, error: "\nCheck failed\nmore detail" }),
        task({ id: "y", status: "blocked", updatedAt: 500, error: "Older" }),
        task({ id: "z", status: "blocked", updatedAt: 1500 }),
      ],
    });
    expect(summary.blocked.map((entry) => [entry.key, entry.detail])).toEqual([
      ["m1:x", "Check failed"],
      ["m1:z", undefined],
    ]);
  });

  it("lists tasks in review and tasks that need input as waiting, whatever their age", () => {
    const summary = build({
      tasks: [
        task({ id: "r", status: "review", updatedAt: 1 }),
        task({ id: "i", status: "running", needsInput: true }),
        task({ id: "n", status: "running" }),
      ],
    });
    expect(summary.waiting.map((entry) => [entry.key, entry.detail])).toEqual([
      ["m1:r", "Ready for review"],
      ["m1:i", "Needs your input"],
    ]);
  });

  it("lists steward suggestions created in the period that are still to do", () => {
    const summary = build({
      tasks: [
        task({ id: "s1", source: "steward", status: "todo", createdAt: 1500 }),
        task({ id: "s2", source: "steward", status: "todo", createdAt: 500 }),
        task({ id: "s3", source: "steward", status: "queued", createdAt: 1500 }),
        task({ id: "m", source: "manual", status: "todo", createdAt: 1500 }),
      ],
    });
    expect(summary.suggestions.map((entry) => entry.key)).toEqual(["m1:s1"]);
  });

  it("shows progress of unfinished goals and goals finished in the period", () => {
    const summary = build({
      tasks: [
        task({ id: "a", status: "done", completedAt: 1500 }),
        task({ id: "b", status: "running" }),
      ],
      goals: [
        goal({ id: "g1", title: "Running", taskIds: ["a", "b"] }),
        goal({ id: "g2", title: "Finished", status: "done", updatedAt: 1500 }),
        goal({ id: "g3", title: "Long ago", status: "done", updatedAt: 10 }),
        goal({ id: "g4", title: "Cancelled", status: "cancelled" }),
      ],
    });
    expect(summary.goals).toEqual([
      { title: "Running", machineName: "this computer", done: 1, total: 2 },
    ]);
    expect(summary.goalsFinished.map((entry) => entry.title)).toEqual(["Finished"]);
  });

  it("ignores the last-known tasks of a machine that did not answer", () => {
    const summary = build({
      tasks: [task({ status: "done", completedAt: 1500, stale: true })],
      unreachable: ["MacBook"],
      outdated: ["Old host"],
    });
    expect(summary.finished).toEqual([]);
    expect(summary.unreachable).toEqual(["MacBook"]);
    expect(summary.outdated).toEqual(["Old host"]);
  });

  it("carries agent time per machine", () => {
    const usage = [{ machineName: "this computer", usedMinutes: 45, dailyAgentMinutes: 120 }];
    expect(build({ usageByMachine: usage }).usage).toEqual(usage);
  });
});

describe("summaryHeadline", () => {
  it("joins the non-zero parts", () => {
    const summary = build({
      tasks: [
        task({ id: "a", status: "done", completedAt: 1500 }),
        task({ id: "b", status: "done", completedAt: 1500 }),
        task({ id: "c", status: "done", completedAt: 1500 }),
        task({ id: "d", status: "blocked", updatedAt: 1500 }),
        task({ id: "e", status: "review" }),
        task({ id: "f", status: "review" }),
      ],
    });
    expect(summaryHeadline(summary)).toBe("3 finished · 1 blocked · 2 waiting for you");
  });

  it("mentions suggestions and omits zero parts", () => {
    const summary = build({
      tasks: [task({ source: "steward", createdAt: 1500 })],
    });
    expect(summaryHeadline(summary)).toBe("1 new suggestion");
  });

  it("says so when there is nothing", () => {
    expect(summaryHeadline(build())).toBe("No background activity");
  });
});
