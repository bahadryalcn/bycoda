import { describe, expect, it } from "vitest";
import { newTaskDraft, hostTaskFromDraft, draftFromTask, type BoardTask } from "./taskClient";
import { newGoalDraft, hostGoalFromDraft } from "./goalClient";
import {
  newStewardDraft,
  hostStewardFromDraft,
  draftFromSteward,
  type BoardSteward,
} from "./stewardClient";
import { parseHostTask } from "./hostTasks";
import { parseHostGoal } from "./hostGoals";
import { parseHostSteward } from "./hostStewards";
import type { ModelRoutingItemChoice } from "../../../shared/model/host-contracts/model-routing";

const cases = [
  {
    name: "task",
    draft: newTaskDraft,
    payload: (choice?: ModelRoutingItemChoice) =>
      hostTaskFromDraft(
        {
          ...newTaskDraft("/project", "claude", "model"),
          title: "Task",
          prompt: "Work",
          modelChoice: choice,
        },
        "task",
        "project",
      ),
    parse: parseHostTask,
  },
  {
    name: "goal",
    draft: newGoalDraft,
    payload: (choice?: ModelRoutingItemChoice) =>
      hostGoalFromDraft(
        {
          ...newGoalDraft("/project", "claude", "model"),
          title: "Goal",
          prompt: "Work",
          modelChoice: choice,
        },
        "goal",
        ["project"],
        "project",
      ),
    parse: parseHostGoal,
  },
  {
    name: "steward",
    draft: newStewardDraft,
    payload: (choice?: ModelRoutingItemChoice) =>
      hostStewardFromDraft(
        { ...newStewardDraft("/project", "claude", "model"), modelChoice: choice },
        "steward",
        "project",
      ),
    parse: parseHostSteward,
  },
];

describe.each(cases)("$name routing", ({ draft, payload, parse }) => {
  it("defaults new capable drafts to the role while retaining a concrete fallback", () => {
    expect(draft("/project", "claude", "model", true)).toMatchObject({
      modelChoice: { kind: "default" },
      harness: "claude",
      model: "model",
      modelSettings: expect.any(Object),
    });
    expect(draft("/project", "claude", "model").modelChoice).toBeUndefined();
  });
  it.each<ModelRoutingItemChoice>([
    { kind: "default" },
    { kind: "order" },
    { kind: "pool", poolId: "pool" },
    { kind: "fixed" },
  ])("carries $kind through payload and parser", (choice) => {
    const input = payload(choice);
    expect(input.modelChoice).toEqual(choice);
    expect(parse(input).modelChoice).toEqual(choice);
  });
  it("preserves missing legacy choices and rejects malformed choices", () => {
    const input = payload();
    expect(input).not.toHaveProperty("modelChoice");
    expect(parse(input)).not.toHaveProperty("modelChoice");
    for (const modelChoice of [
      { kind: "pool" },
      { kind: "other" },
      { kind: "fixed", extra: true },
      null,
    ])
      expect(() => parse({ ...input, modelChoice })).toThrow();
  });
});

it("retains task routing when editing", () => {
  const task = {
    ...cases[0].payload({ kind: "pool", poolId: "pool" }),
    cwd: "/project",
    machineId: "host",
    status: "todo",
  } as BoardTask;
  expect(draftFromTask(task).modelChoice).toEqual({ kind: "pool", poolId: "pool" });
  delete task.modelChoice;
  expect(draftFromTask(task).modelChoice).toBeUndefined();
});

it("retains steward account and routing through edit, save and parsing", () => {
  const input = hostStewardFromDraft(
    {
      ...newStewardDraft("/project", "claude", "model"),
      providerAccountId: "work",
      modelChoice: { kind: "order" },
    },
    "steward",
    "project",
  );
  expect(parseHostSteward(input)).toMatchObject({
    providerAccountId: "work",
    modelChoice: { kind: "order" },
  });
  const draft = draftFromSteward({ ...input, cwd: "/project" } as BoardSteward);
  expect(draft).toMatchObject({ providerAccountId: "work", modelChoice: { kind: "order" } });
  expect(() => parseHostSteward({ ...input, providerAccountId: "bad/id" })).toThrow();
});
