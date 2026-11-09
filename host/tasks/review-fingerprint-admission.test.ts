import { beforeEach, expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";

const f = vi.hoisted(() => ({
  outcome: { state: "finished", status: "succeeded" } as Record<string, unknown>,
  verdict: { verdict: "pass", note: "PASS" },
  acceptance: false,
}));
vi.mock("../sessions/sessionRuns", async (original) => ({
  ...(await original<typeof import("../sessions/sessionRuns")>()),
  sessionRunState: async () => f.outcome,
}));
vi.mock("../assistant/core/assistant-turn-policy", () => ({
  deferredAssistantTurn: async () => false,
}));
vi.mock("./review-outcomes", async (original) => ({
  ...(await original<typeof import("./review-outcomes")>()),
  reviewerVerdict: () => f.verdict,
  reviewerReply: () => "report",
}));
vi.mock("../../src/features/tasks/model/taskInstructions", async (original) => ({
  ...(await original<typeof import("../../src/features/tasks/model/taskInstructions")>()),
  readTaskInstructions: () => ({ acceptance: f.acceptance ? ["criterion"] : [] }),
}));
vi.mock("../../src/features/tasks/model/taskAcceptance", async (original) => ({
  ...(await original<typeof import("../../src/features/tasks/model/taskAcceptance")>()),
  hasTaskAcceptanceReport: () => true,
  parseTaskAcceptance: () => ({
    criteria: [{ verdict: "verified", criterionIndex: 0, criterion: "criterion" }],
  }),
}));
vi.mock("../../src/features/tasks/model/taskReviewNotes", async (original) => ({
  ...(await original<typeof import("../../src/features/tasks/model/taskReviewNotes")>()),
  reviewFindings: () => [],
}));
import { settleVerification } from "./review";
import { NO_VERDICT } from "../../src/features/tasks/model/hostTasks";

function fixture() {
  const workspace = vi.fn(async () => "fresh-workspace");
  const acceptance = vi.fn(async (_task: HostTask, known?: string) =>
    known ? `accept:${known}` : "fresh-acceptance",
  );
  const context = {
    jobs: new Map(),
    limits: { recordRun: vi.fn() },
    store: { session: async () => ({ session: { blocks: [] } }) },
    workspaceFingerprint: workspace,
    acceptanceFingerprint: acceptance,
    find: async () => {
      throw new Error("after-fingerprint");
    },
  } as unknown as TaskContext;
  const task = {
    id: "task",
    status: "verifying",
    prompt: "Work",
    reviewer: {
      sessionId: "review",
      runId: "run",
      acceptanceRequired: true,
      verdictRepairAttempts: 2,
    },
  } as HostTask;
  return { context, task, workspace, acceptance };
}
beforeEach(() => {
  f.outcome = { state: "finished", status: "succeeded" };
  f.verdict = { verdict: "pass", note: "PASS" };
  f.acceptance = false;
});

it("does no repository reads for running polls, ordinary PASS or exhausted missing verdict", async () => {
  const a = fixture();
  f.outcome = { state: "running", needsInput: false };
  await settleVerification(a.context, a.task, 1);
  expect(a.workspace).not.toHaveBeenCalled();
  f.outcome = { state: "finished", status: "succeeded" };
  await expect(settleVerification(a.context, a.task, 1)).rejects.toThrow("after-fingerprint");
  f.verdict = { verdict: "fail", note: NO_VERDICT };
  await expect(settleVerification(a.context, a.task, 1)).rejects.toThrow("after-fingerprint");
  f.outcome = { state: "finished", status: "failed", error: "Reviewer unavailable" };
  await expect(settleVerification(a.context, a.task, 1)).rejects.toThrow("after-fingerprint");
  expect(a.workspace).not.toHaveBeenCalled();
  expect(a.acceptance).not.toHaveBeenCalled();
});

it("takes one fresh repository snapshot for an eligible FAIL and reuses it for crew acceptance", async () => {
  const a = fixture();
  f.verdict = { verdict: "fail", note: "A real finding" };
  await expect(settleVerification(a.context, a.task, 1)).rejects.toThrow("after-fingerprint");
  expect(a.workspace).toHaveBeenCalledTimes(1);
  a.workspace.mockClear();
  f.acceptance = true;
  const crew = { ...a.task, crewRunId: "crew" } as HostTask;
  await expect(settleVerification(a.context, crew, 1)).rejects.toThrow("after-fingerprint");
  expect(a.workspace).toHaveBeenCalledTimes(1);
  expect(a.acceptance).toHaveBeenCalledWith(crew, "fresh-workspace");
});
