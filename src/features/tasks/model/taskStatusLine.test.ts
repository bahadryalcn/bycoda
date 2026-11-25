import { describe, expect, it } from "vitest";
import type { HostTask } from "./hostTasks";
import { firstSentence, taskStatusLine } from "./taskStatusLine";
import { buildTaskStop, type TaskStopInput } from "../../../shared/model/host-contracts/task-stop";

const stopped = (input: TaskStopInput) => buildTaskStop(input, 1);

const task = (overrides: Partial<HostTask>): HostTask => ({
  id: "t",
  title: "Ship",
  prompt: "Do it",
  projectId: "p",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "queued",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const pick = (overrides: Partial<HostTask>) => {
  const { kind, tone, label, detail, notices } = taskStatusLine(task(overrides));
  return { kind, tone, label, detail, notices };
};

it("shows a queued Work admission reason without calling the task running", () => {
  expect(
    pick({ wait: { code: "model_quota", message: "Waiting for a free work slot." } }),
  ).toMatchObject({
    kind: "waiting",
    label: "Waiting for model quota",
    detail: "Waiting for a free work slot.",
  });
  expect(pick({ status: "running", wait: { code: "model_quota", message: "Old hold" } }).kind).toBe(
    "running",
  );
});

describe("firstSentence", () => {
  it("keeps the first sentence on one line and clamps long text at a word", () => {
    expect(firstSentence("Not signed in. Run login first.")).toBe("Not signed in.");
    expect(firstSentence("line one\n\nline two")).toBe("line one line two");
    const long = firstSentence("word ".repeat(60), 40)!;
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("…")).toBe(true);
    expect(firstSentence("   ")).toBeUndefined();
    expect(firstSentence(undefined)).toBeUndefined();
  });
});

describe("taskStatusLine", () => {
  it("labels persisted advisor work as queued waiting, not a running worker", () => {
    expect(
      taskStatusLine(
        task({
          repairAdvisor: {
            requestId: "repair",
            sessionId: "worker",
            findings: "Original finding",
            feedback: "Check failed",
            error: "Check failed",
            fingerprint: "original",
          },
        }),
      ),
    ).toMatchObject({ kind: "queued", label: "Queued", detail: "Waiting for advisor" });
  });

  it("warns only for the current observed stalled run without changing its lifecycle", () => {
    const runStall = { sessionId: "s", runId: "r", lastActivityAt: 100, detectedAt: 900_100 };
    const value = task({ status: "running", sessionId: "s", runId: "r", runStall });
    expect(taskStatusLine(value)).toMatchObject({
      kind: "stalled",
      tone: "warning",
      label: "Running · no recent output",
    });
    expect(value.status).toBe("running");
    expect(
      taskStatusLine({
        ...value,
        stop: stopped({ code: "input_required", message: "Answer needed." }),
      }).kind,
    ).toBe("needs_input");
    expect(taskStatusLine({ ...value, runId: "new" }).kind).toBe("running");
    expect(taskStatusLine({ ...value, status: "queued" }).kind).toBe("queued");
    expect(taskStatusLine({ ...value, runStall: { ...runStall, detectedAt: 200 } }).kind).toBe(
      "running",
    );
  });
  it("names active work calmly, including automatic correction", () => {
    expect(pick({ status: "running" })).toMatchObject({ kind: "running", tone: "accent" });
    expect(pick({ status: "queued" })).toMatchObject({ kind: "queued", tone: "neutral" });
    expect(pick({ status: "verifying" })).toMatchObject({ kind: "verifying", label: "Verifying" });
    expect(
      pick({ status: "running", repairAttempts: 1, repairNote: "Test is red. More text." }),
    ).toEqual({
      kind: "correcting",
      tone: "accent",
      label: "Auto-correcting 1/1",
      detail: "Test is red.",
      notices: 0,
    });
    expect(pick({ status: "queued", repairAttempts: 5, continueUntilDone: true }).label).toBe(
      "Auto-correcting 1/1",
    );
    expect(
      pick({
        status: "running",
        stop: stopped({ code: "input_required", message: "Answer needed." }),
      }),
    ).toMatchObject({
      kind: "needs_input",
      tone: "warning",
    });
  });

  it("does not surface owner notices while the task is still running", () => {
    const ownerNotices = [{ id: "n", kind: "info" as const, message: "Heads up", at: 1 }];
    expect(pick({ status: "running", ownerNotices })).toMatchObject({
      kind: "running",
      notices: 0,
    });
  });

  it("reports finished work with its notice count", () => {
    expect(pick({ status: "review" })).toMatchObject({ kind: "finished", label: "Completed" });
    expect(pick({ status: "done" })).toMatchObject({ kind: "done", tone: "success" });
    const ownerNotices = [
      { id: "a", kind: "remaining_finding" as const, message: "Edge case open", at: 1 },
      { id: "b", kind: "external_check" as const, message: "Try on a device", at: 1 },
    ];
    expect(pick({ status: "review", ownerNotices, completedWithFindings: true })).toEqual({
      kind: "finished_with_notes",
      tone: "warning",
      label: "Completed · 2 notes",
      detail: undefined,
      notices: 2,
    });
    expect(pick({ status: "done", ownerNotices: ownerNotices.slice(0, 1) })).toMatchObject({
      label: "Completed · 1 note",
      tone: "success",
    });
    expect(pick({ status: "review", completedWithFindings: true }).label).toBe(
      "Completed with open findings",
    );
    expect(pick({ status: "review", mergeError: "Dirty checkout. Commit first." })).toMatchObject({
      kind: "delivery_blocked",
      detail: "Dirty checkout.",
    });
  });

  it("names each blocked reason specifically", () => {
    expect(
      pick({
        status: "blocked",
        stop: stopped({ code: "budget_exhausted", message: "Agent minutes 30/30." }),
      }),
    ).toMatchObject({ kind: "budget_stop", tone: "warning", detail: "Agent minutes 30/30." });
    expect(
      pick({
        status: "blocked",
        stop: stopped({ code: "owner_stopped", message: "Stopped by you." }),
      }),
    ).toMatchObject({ kind: "stopped_by_owner", tone: "neutral", label: "Stopped by you" });
    expect(
      pick({
        status: "blocked",
        stop: stopped({ code: "owner_stopped", message: "x", nextAction: "restart" }),
      }),
    ).toMatchObject({ kind: "awaiting_restart" });
    expect(
      pick({
        status: "blocked",
        continueUntilDone: true,
        stop: stopped({
          code: "repair_exhausted",
          repair: "external",
          message: "Needs an Android device.",
        }),
      }),
    ).toMatchObject({ kind: "external_check", detail: "Needs an Android device." });
    expect(
      pick({
        status: "blocked",
        blockedTakeover: { at: 1, blocker: "Missing evidence." },
        stop: stopped({
          code: "run_failed",
          phase: "review",
          message: "Review failed: Missing evidence.",
          nextAction: "provide_input",
        }),
        verification: { review: { verdict: "fail", note: "Missing evidence.", sessionId: "r" } },
      }),
    ).toMatchObject({ kind: "needs_instructions", detail: "Review failed: Missing evidence." });
    expect(
      pick({
        status: "blocked",
        stop: stopped({ code: "host_interrupted", message: "The host stopped during this run." }),
      }),
    ).toMatchObject({ kind: "interrupted", tone: "danger" });
    expect(
      pick({
        status: "blocked",
        stop: stopped({
          code: "run_failed",
          phase: "review",
          message: "Review failed: Missing evidence.",
          nextAction: "retry",
        }),
        verification: { review: { verdict: "fail", note: "Missing evidence.", sessionId: "r" } },
      }),
    ).toMatchObject({ kind: "review_failed", detail: "Review failed: Missing evidence." });
    expect(
      pick({
        status: "blocked",
        stop: stopped({ code: "run_failed", phase: "check", message: "The check command failed." }),
        verification: { command: { exitCode: 1, output: "", timedOut: false } },
      }),
    ).toMatchObject({ kind: "checks_failed" });
    expect(
      pick({
        status: "blocked",
        stop: stopped({ code: "run_failed", phase: "worker", message: "Provider disconnected" }),
      }),
    ).toEqual({
      kind: "failed",
      tone: "danger",
      label: "Failed",
      detail: "Provider disconnected",
      notices: 0,
    });
  });

  it("shows a blocked task saved without a stop code as having no recorded reason", () => {
    expect(pick({ status: "blocked", error: "Provider disconnected" })).toEqual({
      kind: "unrecorded",
      tone: "neutral",
      label: "Blocked",
      detail: "Reason not recorded",
      notices: 0,
    });
  });

  it("shows the dependency a queued task waits on, with its stop code once it is blocked", () => {
    expect(
      pick({
        wait: {
          code: "dependency",
          waitsOn: { taskId: "d", code: "budget_exhausted" },
          message: "Waiting for Build.",
        },
      }),
    ).toMatchObject({
      kind: "waiting",
      label: "Waiting for a dependency",
      detail: "Dependency: Run budget reached",
    });
  });

  it("names the correction limit with its reason", () => {
    expect(
      pick({
        status: "blocked",
        repairAttempts: 3,
        stop: stopped({
          code: "repair_exhausted",
          repair: "limit",
          message: "Three corrections failed. Clarify the goal.",
        }),
      }),
    ).toMatchObject({
      kind: "correction_limit",
      label: "Correction limit reached",
      detail: "Three corrections failed.",
    });
  });

  it("offers an automatic takeover before asking the owner", () => {
    expect(
      pick({
        status: "blocked",
        sessionId: "w",
        stop: stopped({
          code: "run_failed",
          phase: "review",
          message: "Review failed: Missing evidence.",
          nextAction: "takeover",
        }),
        verification: { review: { verdict: "fail", note: "Missing evidence.", sessionId: "r" } },
      }),
    ).toMatchObject({ kind: "takeover", label: "AI takeover pending" });
  });
});
