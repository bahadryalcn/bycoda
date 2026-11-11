import { describe, expect, it } from "vitest";
import type { HostTask, TaskReviewNote } from "../../src/features/tasks/model/hostTasks";
import { FEEDBACK_LIMIT, reviewPrompt, workerPrompt } from "./prompts";

const brief = JSON.stringify({
  schema: "bycoda.task.v1",
  objective: "Build a simple snake game",
  deliverables: ["index.html"],
  acceptance: ["The snake grows when it eats"],
  constraints: [],
  verification: [],
});

function task(overrides: Partial<HostTask> = {}): HostTask {
  return {
    id: "task-a",
    title: "Snake game",
    prompt: brief,
    projectId: "project-a",
    harness: "codex",
    model: "assigned-model",
    modelSettings: {},
    runtimeMode: "full-access",
    maxRunMinutes: 30,
    status: "queued",
    createdAt: 1,
    updatedAt: 2,
    worktreeCwd: "G:/checkout",
    branch: "task-branch",
    baseCommit: "base-commit",
    verifyCommand: "pnpm test",
    ...overrides,
  };
}

function note(index: number, extra: Partial<TaskReviewNote> = {}): TaskReviewNote {
  return {
    id: `note-${index}`,
    kind: "finding",
    finding: `Finding number ${index}: the food spawns inside the snake body`,
    suggestion: `Suggestion ${index}: pick a free cell`,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as TaskReviewNote;
}

const repair = (extra: Partial<HostTask> = {}) =>
  task({
    repairAttempts: 1,
    reviewNotes: [1, 2, 3, 4, 5].map((index) => note(index)),
    retryFeedback: "Verification failed.\n\nCheck command: pnpm test\n\n1 test failed",
    attemptHistory: [
      {
        attempt: 1,
        at: 1,
        reviewerSessionId: "reviewer",
        workerSummary: "Built the board",
        verdict: "fail",
        note: "five findings",
        findings: ["Finding number 1"],
      },
    ],
    ...extra,
  });

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe("task prompts", () => {
  it("sends a first-run worker no continuation block or empty scaffolding", () => {
    const prompt = workerPrompt(task(), "G:/project");
    expect(prompt).toContain("Build a simple snake game");
    expect(prompt).toContain("pnpm test");
    for (const word of ["continuation", "nextAction", "recentAttempts", "openFindings", "runtime"])
      expect(prompt).not.toContain(word);
    expect(JSON.parse(prompt.slice(prompt.indexOf("{"))).task.id).toBe("task-a");
    expect(prompt.length).toBeLessThan(2400);
  });

  it("carries each finding once on a repair and skips the reviewer's free text", () => {
    const prompt = workerPrompt(repair(), "G:/project");
    for (const index of [1, 2, 3, 4, 5]) {
      expect(occurrences(prompt, `Finding number ${index}:`)).toBe(1);
      expect(occurrences(prompt, `Suggestion ${index}:`)).toBe(1);
    }
    expect(occurrences(prompt, "Check command: pnpm test")).toBe(1);
    expect(occurrences(prompt, "The snake grows when it eats")).toBe(1);
    expect(prompt).toContain("Built the board");
    expect(prompt).not.toContain("bycoda.task-continuation.v1");
  });

  it("keeps all earlier feedback under one total cap", () => {
    const huge = "x".repeat(30_000);
    const prompt = workerPrompt(
      repair({
        retryFeedback: huge,
        reviewNotes: [1, 2, 3].map((index) => note(index, { details: huge })),
      }),
      "G:/project",
    );
    const start = prompt.indexOf("Open review notes");
    const feedback = prompt.slice(start);
    expect(feedback.length).toBeLessThanOrEqual(FEEDBACK_LIMIT + 1500);
    expect(prompt.length).toBeLessThan(FEEDBACK_LIMIT + 4000);
  });

  it("gives the reviewer the brief and verdict rules without runtime or continuation text", () => {
    const prompt = reviewPrompt(
      repair({ verification: { command: { exitCode: 0, output: "", timedOut: false } } }),
    );
    expect(prompt).toContain("Build a simple snake game");
    expect(prompt).toContain("VERDICT: PASS");
    expect(prompt).toContain("VERDICT: FAIL - ");
    expect(prompt).toContain('"result": "passed"');
    expect(prompt).toContain("note-1: Finding number 1");
    expect(occurrences(prompt, "The snake grows when it eats")).toBe(1);
    expect(occurrences(prompt, "reviewNotes")).toBe(1 + occurrences(prompt, "bycoda.acceptance"));
    for (const word of ["continuation", "nextAction", "runtime", "execution", "Suggestion 1"])
      expect(prompt).not.toContain(word);
  });
});
