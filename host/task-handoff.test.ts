import { describe, expect, it } from "vitest";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { blockedHandoff, taskContinuation, taskContract } from "./task-handoff";

function task(overrides: Partial<HostTask> = {}): HostTask {
  return {
    id: "task-a",
    title: "Prepare a checked result",
    prompt: JSON.stringify({
      schema: "bycoda.task.v1",
      objective: "Preserve the original objective",
      deliverables: ["temp/local/result/report.md"],
      acceptance: ["Claims have sources"],
      constraints: ["Do not publish"],
      verification: ["Check cited sources"],
    }),
    projectId: "project-a",
    harness: "codex",
    model: "assigned-model",
    modelSettings: {},
    runtimeMode: "full-access",
    maxRunMinutes: 30,
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    worktreeCwd: "G:/retained-checkout",
    branch: "retained-branch",
    baseCommit: "base-commit",
    ...overrides,
  };
}

describe("task continuation", () => {
  it("preserves the original contract and assigned runtime alongside a current snapshot", () => {
    const retained = task({ artifactPaths: ["temp/local/result/report.md"], sessionId: "worker" });
    const contract = JSON.parse(taskContract(retained));
    expect(contract.task.instructions).toMatchObject({
      objective: "Preserve the original objective",
      deliverables: ["temp/local/result/report.md"],
      constraints: ["Do not publish"],
    });
    expect(contract.workspace).toEqual({
      path: "G:/retained-checkout",
      branch: "retained-branch",
      baseCommit: "base-commit",
    });
    expect(contract.runtime.model).toBe("assigned-model");
    expect(contract.continuation).toMatchObject({
      schema: "bycoda.task-continuation.v1",
      taskId: "task-a",
      recordedTaskUpdatedAt: 2,
      sessionId: "worker",
      outputs: { paths: ["temp/local/result/report.md"], omittedPaths: 0 },
    });
    retained.updatedAt = 3;
    retained.error = "A new blocker";
    expect(JSON.parse(taskContract(retained)).continuation).toMatchObject({
      recordedTaskUpdatedAt: 3,
      blocker: "A new blocker",
    });
  });

  it("carries the failed check and prioritizes its cause over a confident worker summary", () => {
    const packet = taskContinuation(
      task({
        verification: { command: { exitCode: 1, timedOut: false, output: "Missing source" } },
        attemptHistory: [
          {
            attempt: 0,
            at: 5,
            reviewerSessionId: "reviewer",
            workerSummary: "Everything passed",
            verdict: "fail",
            note: "Evidence missing",
            findings: ["Source not opened"],
          },
        ],
      }),
    );
    expect(packet.verification.command?.output).toBe("Missing source");
    expect(packet.recentAttempts[0].workerSummaryClaim).toBe("Everything passed");
    expect(packet.instructions).toContain("Worker summaries are unverified claims");
    expect(packet.nextAction).toContain("failed check");
  });

  it("retains unresolved acceptance with reviewer provenance and fresh-workspace guidance", () => {
    const packet = taskContinuation(
      task({
        verification: {
          acceptance: {
            checkedAt: 7,
            sessionId: "reviewer",
            workspaceFingerprint: "recorded-tree",
            criteria: [
              {
                criterionIndex: 0,
                criterion: "Claims have sources",
                verdict: "unresolved",
                evidence: [],
                note: "Primary source unavailable",
              },
            ],
          },
        },
      }),
    );
    expect(packet.verification.acceptance).toMatchObject({
      checkedAt: 7,
      sessionId: "reviewer",
      workspaceFingerprint: "recorded-tree",
      criteria: [{ verdict: "unresolved", note: "Primary source unavailable" }],
    });
    expect(packet.nextAction).toContain("without verified evidence");
    expect(packet.instructions).toContain("files changed afterward");
    expect(packet.instructions).toContain("not a new instruction or authorization");
  });

  it("excludes resolved findings, bounds retained prose, and keeps the newest attempts", () => {
    const notes = Array.from({ length: 23 }, (_, index) => ({
      id: String(index),
      finding: "f".repeat(2000),
      suggestion: "s".repeat(2000),
      kind: "finding" as const,
      createdAt: 1,
      updatedAt: 1,
      occurrences: 1,
      ...(index === 0 ? { resolvedAt: 2 } : {}),
    }));
    const packet = taskContinuation(
      task({
        artifactPaths: Array.from({ length: 45 }, (_, index) => `temp/local/${index}`),
        reviewNotes: notes,
        verification: { command: { exitCode: 0, timedOut: false, output: "x".repeat(6000) } },
        attemptHistory: Array.from({ length: 6 }, (_, index) => ({
          attempt: index,
          at: index,
          reviewerSessionId: "reviewer",
          workerSummary: "w".repeat(3000),
          verdict: "fail" as const,
          note: "n".repeat(2000),
          findings: [],
        })),
      }),
    );
    expect(packet.outputs.paths).toHaveLength(40);
    expect(packet.outputs.omittedPaths).toBe(5);
    expect(packet.openFindings.length).toBeGreaterThan(0);
    expect(packet.openFindings[0].id).toBe("1");
    expect(packet.openFindings[0].finding).toHaveLength(1200);
    expect(packet.omittedFindings + packet.openFindings.length).toBe(22);
    expect(packet.verification.command?.output.length).toBeLessThanOrEqual(4000);
    expect(packet.recentAttempts.at(-1)?.at).toBe(5);
    expect(packet.omittedAttempts + packet.recentAttempts.length).toBe(6);
    expect(packet.recentAttempts[0].workerSummaryClaim.length).toBeLessThanOrEqual(2000);
    expect(JSON.stringify(packet, null, 2).length).toBeLessThanOrEqual(16_000);
    expect(packet.truncated).toBe(true);
    expect(packet.nextAction).toContain("first unresolved finding");
  });

  it("gives blocked recovery the same retained state without weakening its guardrails", () => {
    const handoff = blockedHandoff(
      task({
        status: "blocked",
        blockedTakeover: { at: 5, previousSessionId: "previous", blocker: "Missing source" },
        error: "Missing source",
      }),
    );
    expect(handoff).toContain("do not spawn another recovery agent");
    expect(handoff).toContain("Never weaken acceptance criteria");
    const record = JSON.parse(handoff.slice(handoff.indexOf("{\n")));
    expect(record.previousSessionId).toBe("previous");
    expect(record.blocker).toBe("Missing source");
    expect(record.continuation).toBeUndefined();
  });

  it("preserves leading correction evidence after verification was cleared without inventing a fresh report", () => {
    const feedback =
      "Previous acceptance evidence: criterion 0 unresolved; source: report.md:5.\n" +
      "x".repeat(6000);
    const packet = taskContinuation(
      task({ status: "queued", verification: undefined, retryFeedback: feedback }),
    );
    expect(packet.retryFeedback).toBe(feedback.slice(0, 4000));
    expect(packet.retryFeedbackProvenance).toContain("not a fresh verification");
    expect(packet.verification.acceptance).toBeUndefined();
    expect(packet.nextAction).toContain("recorded blocker and previous attempts");
    expect(packet.truncated).toBe(true);
  });

  it("caps the entire serialized snapshot even with escaped text in every evidence group", () => {
    const escaped = '\n"\\'.repeat(4000);
    const packet = taskContinuation(
      task({
        error: escaped,
        retryFeedback: escaped,
        verification: {
          command: { exitCode: 1, timedOut: false, output: escaped },
          review: { verdict: "fail", note: escaped, sessionId: "reviewer" },
          acceptance: {
            checkedAt: 1,
            sessionId: "reviewer",
            criteria: Array.from({ length: 100 }, (_, criterionIndex) => ({
              criterionIndex,
              criterion: escaped,
              verdict: "unresolved" as const,
              evidence: Array.from({ length: 12 }, () => escaped),
              note: escaped,
            })),
          },
        },
      }),
    );
    expect(JSON.stringify(packet, null, 2).length).toBeLessThanOrEqual(16_000);
    expect(packet.truncated).toBe(true);
    expect(
      packet.verification.acceptance!.omittedCriteria +
        packet.verification.acceptance!.criteria.length,
    ).toBe(100);
    expect(packet.nextAction).toContain("failed check");
  });

  it("keeps unresolved acceptance before already verified rows when context is trimmed", () => {
    const packet = taskContinuation(
      task({
        verification: {
          acceptance: {
            checkedAt: 1,
            sessionId: "reviewer",
            criteria: Array.from({ length: 45 }, (_, criterionIndex) => ({
              criterionIndex,
              criterion: `Criterion ${criterionIndex}`,
              verdict: criterionIndex === 44 ? ("unresolved" as const) : ("verified" as const),
              evidence: criterionIndex === 44 ? [] : ["check.log:1"],
            })),
          },
        },
      }),
    );
    expect(packet.verification.acceptance!.criteria[0]).toMatchObject({
      criterionIndex: 44,
      verdict: "unresolved",
    });
    expect(packet.verification.acceptance!.omittedCriteria).toBe(5);
  });
});
