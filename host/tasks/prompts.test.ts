import { describe, expect, it } from "vitest";
import type { HostTask, TaskReviewNote } from "../../src/features/tasks/model/hostTasks";
import { FEEDBACK_LIMIT, reviewPrompt, workerPrompt } from "./prompts";
import { CREW_TOOL_INSTRUCTIONS } from "../crews/crew-member-ask";
import { crewMemberScope, crewTaskPrompt } from "../crews/crew-task-prompt";
import { workPrompt } from "./work-request";

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

  it("limits review failures and release expectations to the task", () => {
    const prompt = reviewPrompt(task({ title: "Publishable snake game" }));
    expect(prompt).toContain("A failed configured check is a reason to FAIL only");
    expect(prompt).toContain(
      "Apply release-tier expectations only when the task explicitly requests a release",
    );
    expect(prompt).toContain("a title such as publishable alone does not request one");
    expect(prompt).toContain('suggestions (kind "suggestion"), never a reason to FAIL');
    expect(prompt).toContain("security, data loss, permission/approval gates");
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

  it("pins the length of the five reference prompts at or below their earlier size", () => {
    // Ceilings are the sizes measured before the shared rules and the shortened retry text.
    const plain = { verifyCommand: undefined, worktreeCwd: undefined, branch: undefined };
    const sizes = {
      simple: [
        workerPrompt(task({ ...plain, prompt: "Fix the login button label." }), "G:/p"),
        764,
      ],
      context: [
        workerPrompt(
          task({
            ...plain,
            prompt: workPrompt(
              "Fix the second bug we just discussed.",
              "The login button label reads Sing in (src/Login.tsx).",
            ),
          }),
          "G:/p",
        ),
        1302,
      ],
      crewMember: [
        workerPrompt(
          task({
            ...plain,
            isolate: false,
            prompt: crewTaskPrompt({
              request: "Review the login change.",
              instructions: "Review code carefully and report findings.",
              tools: CREW_TOOL_INSTRUCTIONS,
              scope: crewMemberScope(["src/a.ts"]),
            }),
          }),
          "G:/p",
        ),
        2103,
      ],
      repair: [workerPrompt(repair(), "G:/project"), 2828],
      reviewer: [reviewPrompt(task()), 4039],
    } as const;
    for (const [name, [prompt, ceiling]] of Object.entries(sizes))
      expect(prompt.length, name).toBeLessThanOrEqual(ceiling);
  });

  it("shares the checkout and no-commit rules once per crew prompt", () => {
    const prompt = workerPrompt(
      task({
        isolate: false,
        worktreeCwd: undefined,
        prompt: crewTaskPrompt({
          request: "Review.",
          instructions: "Careful.",
          tools: CREW_TOOL_INSTRUCTIONS,
          scope: crewMemberScope(["src/a.ts"]),
        }),
      }),
      "G:/p",
    );
    expect(occurrences(prompt, "do not stage, commit, merge or push")).toBe(1);
    expect(prompt).not.toContain("Do not stage, commit, merge or push");
  });

  it("passes a long earlier check as a short summary with a reference", () => {
    const prompt = workerPrompt(repair({ retryFeedback: "x".repeat(4_000) }), "G:/project");
    expect(prompt).not.toContain("x".repeat(600));
    expect(prompt).toContain("retryFeedback of task task-a");
  });

  it("gives a correction round's reviewer only the open findings", () => {
    const resolved = note(9, { resolvedAt: 5 });
    const prompt = reviewPrompt(repair({ reviewNotes: [note(1), resolved] }));
    expect(prompt).toContain("note-1:");
    expect(prompt).not.toContain("Finding number 9");
  });
});
