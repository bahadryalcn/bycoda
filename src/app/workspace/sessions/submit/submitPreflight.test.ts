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
