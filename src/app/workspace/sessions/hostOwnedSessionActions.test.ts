// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { registerRemoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { useApprovalActions } from "./useApprovalActions";
import { useSessionDraftActions, type SessionDraftActionDeps } from "./useSessionDraftActions";
import { usePlanActions } from "./usePlanActions";

const native = vi.hoisted(() => ({
  approve: vi.fn(),
  answer: vi.fn(),
  keepOpen: vi.fn(),
  discard: vi.fn(),
}));
const state = vi.hoisted(() => ({
  sessionsRef: { current: [] as Session[] },
  setSessions: vi.fn(),
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => state);
vi.mock("../../../integrations/harness", () => ({
  respondHarnessApproval: native.approve,
  respondHarnessQuestion: native.answer,
  keepHarnessQuestionOpen: native.keepOpen,
}));
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { forSession: () => undefined },
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  discardDraftSessionRecord: native.discard,
  shouldPersistSession: () => false,
}));

it("routes local Host approvals, questions, drafts and plan builds through owner actions and stays closed after detach", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const session = newSession("codex", "G:/local-project");
  session.hostBinding = {
    kind: "local-host",
    machineId: "local",
    environmentId: "home",
    projectId: "project",
    sessionId: session.id,
    authorityGeneration: 1,
    created: true,
  };
  session.pendingQuestion = {
    requestId: 7,
    questions: [],
  } as unknown as Session["pendingQuestion"];
  state.sessionsRef.current = [session];
  const owner = {
    approve: vi.fn(),
    answer: vi.fn(),
    saveDraft: vi.fn(() => true),
    removeDraft: vi.fn(() => true),
    buildPlan: vi.fn(),
  };
  const detach = registerRemoteSessionActions(session.id, owner as never);
  let approval!: ReturnType<typeof useApprovalActions>;
  let draft!: ReturnType<typeof useSessionDraftActions>;
  let plan!: ReturnType<typeof usePlanActions>;
  const onSubmit = vi.fn();
  const root = createRoot(document.createElement("div"));
  function Fixture() {
    approval = useApprovalActions({
      sessionsRef: state.sessionsRef,
      setInspectedWorkerId: vi.fn(),
      focusOpenSession: () => true,
      onSelectHistorySession: async () => {},
    });
    draft = useSessionDraftActions({} as SessionDraftActionDeps);
    plan = usePlanActions({ onSubmit });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Fixture)));
    approval.onApproval(session.id, 9, "allow");
    approval.onQuestionReply(session.id, 7, { answers: [] } as never);
    approval.onQuestionInteraction(session.id, 7);
    expect(draft.onSaveDraft(session.id, "retain draft", [])).toBe(true);
    expect(draft.onRemoveDraft(session.id, "draft")).toBe(true);
    plan.onBuildPlan(session.id, "plan");
    expect(owner.approve).toHaveBeenCalledWith(9, "allow");
    expect(owner.answer).toHaveBeenCalledWith(7, { answers: [] });
    expect(owner.saveDraft).toHaveBeenCalledWith("retain draft", []);
    expect(owner.buildPlan).toHaveBeenCalledWith("plan", undefined);
    detach();
    approval.onApproval(session.id, 10, "deny");
    expect(() => approval.onQuestionReply(session.id, 7, { answers: [] } as never)).toThrow(
      "unavailable",
    );
    expect(draft.onSaveDraft(session.id, "offline", [])).toBe(false);
    expect(draft.onRemoveDraft(session.id, "draft")).toBe(false);
    expect(native.approve).not.toHaveBeenCalled();
    expect(native.answer).not.toHaveBeenCalled();
    expect(native.keepOpen).not.toHaveBeenCalled();
    expect(native.discard).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  } finally {
    detach();
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
