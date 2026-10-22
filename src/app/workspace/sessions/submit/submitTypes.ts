import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ControlOutcome } from "../../../../features/orchestration/model/orchestration";
import type { OrchestrationProposal } from "../../../../features/orchestration/model/orchestrationPlan";
import type { EditedResendCoordinator, createEditedResendAttempt } from "../../../../features/sessions/model/editLastTurn";
import type { pendingHandoff } from "../../../../features/sessions/model/handoff";
import type { consumeOperatorCommand } from "../../../../features/sessions/model/operatorCommand";
import type { Attachment, PlanBuildTarget, QueuedMessage, Session } from "../../../../features/sessions/model/session";
import type { HarnessEvent } from "../../../../integrations/harness";
import type { beginSessionPerformanceTrace } from "../../../../shared/lib/performanceTrace";
import type { useOwnedTimeout } from "../../../../shared/hooks/useOwnedTimeout";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import type { useWorkspaceNavigation } from "../../../hooks/useWorkspaceNavigation";
import type { Submit, SubmitOptions } from "../../helpers/types";
import type { useProjectLocationChange, useProjectLocationSyncs } from "../../projects/useProjectLocation";
import type { ProviderAccountRecovery } from "../../surfaces/useProviderSignInPrompts";
import type { useSessionShell } from "../useSessionShell";

/** Ref objects and ref-like coordinators owned by `Workspace`. */
export interface SubmitRefs {
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingSessionIds: MutableRefObject<Set<string>>;
  editedResends: EditedResendCoordinator;
  retiringTurns: MutableRefObject<Map<string, number>>;
  turnGen: MutableRefObject<Map<string, number>>;
  removingSessionIds: MutableRefObject<Set<string>>;
  switchingWorktrees: MutableRefObject<Map<string, string>>;
  removingWorktreePaths: MutableRefObject<Set<string>>;
  workspacePins: MutableRefObject<Map<string, string>>;
  projectLocationSyncs: ReturnType<typeof useProjectLocationSyncs>;
  submitAfterProjectSyncRef: MutableRefObject<Submit>;
  activeSessionIdRef: MutableRefObject<string | undefined>;
}

/** Everything `useSubmitSession` needs from `Workspace`. */
export interface SubmitDeps {
  refs: SubmitRefs;
  /** Read lazily: the submit ref is declared after the hook call in `Workspace`. */
  getSubmitSessionRef: () => MutableRefObject<Submit>;
  workspaceNavigation: ReturnType<typeof useWorkspaceNavigation>;
  applyProjectLocationChange: ReturnType<typeof useProjectLocationChange>["applyProjectLocationChange"];
  dismissNoticesForContinuedSession: (sessionId: string) => void;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
  runSessionShell: ReturnType<typeof useSessionShell>["runSessionShell"];
  setProviderAccountRecovery: Dispatch<SetStateAction<ProviderAccountRecovery | null>>;
  deferWorkspaceWork: ReturnType<typeof useOwnedTimeout>;
}

export interface SubmitInput {
  sessionId: string;
  text: string;
  attachments: Attachment[];
  options: SubmitOptions | undefined;
}

export type SubmitWrap = {
  from: Session["harness"];
  to: Session["harness"];
  text: string;
};

/**
 * Mutable per-turn state shared by the turn phases. Each field replaces a `let`
 * of the original `submitSession` body that was reassigned after its declaration
 * or from inside a closure.
 */
export interface SubmitTurn {
  proposalDraft: OrchestrationProposal | undefined;
  controlOutcome: ControlOutcome;
  controlText: string;
  proposalText: string;
  nativeProposalText: string;
  completedProposal: OrchestrationProposal | undefined;
  wrap: SubmitWrap | null;
  nativePlanSeen: boolean;
  providerFailureSeen: boolean;
  buildSucceeded: boolean;
  checkpointStarted: boolean;
  checkpointRetirementUncertain: boolean;
  sawProviderEvent: boolean;
  contextReplayAccepted: boolean;
}

/** Values computed before the busy/project/turn branches, read-only afterwards. */
export interface SubmitPreflight {
  storedCurrent: Session;
  draftBlock: Session["blocks"][number] | undefined;
  current: Session;
  submitTarget: QueuedMessage["modelTarget"] | PlanBuildTarget | undefined;
  editedResend: ReturnType<typeof createEditedResendAttempt> | undefined;
  editedProviderTurnId: string | undefined;
  intent: NonNullable<SubmitOptions["intent"]>;
  approvedPlan: Session["blocks"][number] | undefined;
  noteCard: Session["noteCard"];
  handoffCard: Session["handoffCard"];
  providerAccountId: string | undefined;
  initialWorkCwd: string;
  createDraftWorktree: boolean;
  submittedText: string;
  operatorCommand: ReturnType<typeof consumeOperatorCommand>;
  operatorAccess: boolean;
  promptText: string;
  rawCommand: boolean;
  ciContext: string | undefined;
  harnessText: string;
  pendingSwitch: NonNullable<Session["pendingSwitch"]> | null;
}

/** Values produced by the turn setup phase and consumed by the run/dispatch phases. */
export interface SubmitSetup {
  traceId: ReturnType<typeof beginSessionPerformanceTrace>;
  gen: number;
  proposalId: string | undefined;
  queuedHandoff: ReturnType<typeof pendingHandoff> | null;
  commitSubmittedTurn: () => void;
  launchTitleGeneration: (workCwd: string) => void;
  turn: SubmitTurn;
}

/** A phase either settles the submission with its acceptance or hands its prepared values on. */
export type PreflightResult =
  | { settled: true; value: SubmissionAcceptance }
  | { settled: false; pre: SubmitPreflight };

export type SetupResult =
  | { settled: true; value: SubmissionAcceptance }
  | { settled: false; setup: SubmitSetup };
