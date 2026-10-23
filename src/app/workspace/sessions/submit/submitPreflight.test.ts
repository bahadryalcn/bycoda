// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block } from "../../../../features/sessions/model/session";
import { resetSessionsStore } from "../../../../features/sessions/model/sessionsStore";
import { prepareSubmitPreflight } from "./submitPreflight";
import type { SubmitDeps } from "./submitTypes";

vi.mock("../../../../features/orchestration/model/orchestration", () => ({
  orchestrator: {
    submissionError: () => undefined,
    forSession: () => undefined,
    run: () => undefined,
  },
}));
vi.mock("../../../../integrations/harness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../integrations/harness")>()),
  steerAppliesModelSettings: () => true,
}));
vi.mock("../../../../features/providers/model/providerAccounts", () => ({
  supportsProviderAccounts: () => false,
  providerAccountExists: () => true,
  sessionProviderAccountId: () => undefined,
}));

const plan: Block = {
  id: "plan",
  role: "plan",
  text: "# Edited plan\n\n1. Fix it.",
  plan: { status: "ready", originalText: "# Original" },
};
let session = newSession("codex", "/repo");
const ctx = {
  flushHarnessEvents: vi.fn(),
  enqueueHarnessEvent: vi.fn(),
  workspaceNavigation: { isSwitching: () => false },
  refs: {
    editedResends: { isActive: () => false },
    removingSessionIds: { current: new Set() },
    switchingWorktrees: { current: new Map() },
    removingWorktreePaths: { current: new Set() },
  },
} as unknown as SubmitDeps;
beforeEach(() => {
  session = { ...newSession("codex", "/repo"), blocks: [plan] };
  resetSessionsStore([session]);
});
it("routes an explicit message through the same approved-plan dispatch as Build", () => {
  const result = prepareSubmitPreflight(ctx, {
    sessionId: session.id,
    text: "planı uygula",
    attachments: [],
    options: { intent: "default" },
  });
  expect(result.settled).toBe(false);
  if (result.settled) throw new Error("submission rejected");
  expect(result.pre.intent).toBe("build");
  expect(result.pre.approvedPlan?.text).toBe(plan.text);
});
it("preserves a refinement as a normal message", () => {
  const result = prepareSubmitPreflight(ctx, {
    sessionId: session.id,
    text: "planı uygula ama önce değişiklikleri tartışalım",
    attachments: [],
    options: undefined,
  });
  if (result.settled) throw new Error("submission rejected");
  expect(result.pre.intent).toBe("default");
  expect(result.pre.approvedPlan).toBeUndefined();
});
it("rejects repeated Build requests for an already built plan", () => {
  resetSessionsStore([{ ...session, blocks: [{ ...plan, plan: { status: "built" } }] }]);
  expect(
    prepareSubmitPreflight(ctx, {
      sessionId: session.id,
      text: "Build approved plan",
      attachments: [],
      options: { intent: "build", planBlockId: plan.id },
    }),
  ).toEqual({ settled: true, value: false });
});
it("steers a row saved for another effort into the running turn with its own settings", () => {
  const running = { harness: "codex" as const, model: "running", modelSettings: { effort: "low" } };
  resetSessionsStore([
    {
      ...session,
      busy: true,
      model: "later",
      runningModelTarget: running,
      queuedMessages: [
        {
          id: "row",
          text: "follow up",
          attachments: [],
          modelTarget: { ...running, modelSettings: { effort: "high" } },
        },
      ],
    },
  ]);
  const result = prepareSubmitPreflight(ctx, {
    sessionId: session.id,
    text: "follow up",
    attachments: [],
    options: { queuedMessageId: "row", followUpBehavior: "steer" },
  });
  if (result.settled) throw new Error("submission rejected");
  expect(result.pre.current).toMatchObject({
    harness: "codex",
    model: "running",
    modelSettings: { effort: "high" },
  });
});
it("does not let a row saved for another model join the running turn", () => {
  const running = { harness: "codex" as const, model: "running", modelSettings: {} };
  resetSessionsStore([
    {
      ...session,
      busy: true,
      runningModelTarget: running,
      queuedMessages: [
        {
          id: "row",
          text: "follow up",
          attachments: [],
          modelTarget: { ...running, model: "saved" },
        },
      ],
    },
  ]);
  expect(
    prepareSubmitPreflight(ctx, {
      sessionId: session.id,
      text: "follow up",
      attachments: [],
      options: { queuedMessageId: "row", followUpBehavior: "steer" },
    }),
  ).toEqual({ settled: true, value: false });
});
it("switches provider for a steered row saved for another provider", () => {
  const running = { harness: "codex" as const, model: "running", modelSettings: {} };
  resetSessionsStore([
    {
      ...session,
      busy: true,
      blocks: [{ id: "user", role: "user", text: "start" }],
      runningModelTarget: running,
      queuedMessages: [
        {
          id: "row",
          text: "follow up",
          attachments: [],
          modelTarget: { harness: "claude", model: "claude:opus", modelSettings: {} },
        },
      ],
    },
  ]);
  const result = prepareSubmitPreflight(ctx, {
    sessionId: session.id,
    text: "follow up",
    attachments: [],
    options: { queuedMessageId: "row", followUpBehavior: "steer" },
  });
  if (result.settled) throw new Error("submission rejected");
  expect(result.pre.current.harness).toBe("claude");
  expect(result.pre.pendingSwitch?.from).toBe("codex");
});
