import type { SubmitDeps, SubmitInput, SubmitPreflight, SubmitSetup } from "./submitTypes";
import { createSubmitTurnEvents } from "./submitTurnEvents";
import { runSubmitDispatch } from "./submitTurnDispatch";

import { discoverOrchestrationSettings } from "../../../../features/orchestration/model/orchestrationCatalog";
import {
  completeOrchestrationProposal,
  withOrchestrationProposal,
} from "../../../../features/orchestration/model/orchestrationPlan";
import { invalidateProjectLocation } from "../../../../features/projects/model/projectLocation";
import { notifyReviewChanged } from "../../../../features/sessions/model/checkpoint";
import {
  chooseHandoffBrief,
  shouldAskOutgoingAgent,
} from "../../../../features/sessions/model/handoff";
import { requestOutgoingHandoff } from "../../../../features/sessions/model/handoffTurn";
import { sessionWorkCwd } from "../../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import {
  createWorktree,
  namedWorktreeBranch,
  renameWorktreeBranch,
  temporaryWorktreeBranchName,
} from "../../../../features/source-control/model/worktrees";
import {
  forgetHarnessSession,
  generateHarnessBranchName,
  isLiveHarness,
  pickTextHarness,
  stopStreaming,
} from "../../../../integrations/harness";
import { pathKey } from "../../../../shared/lib/paths";
import { currentWorkspace } from "../../helpers/appHelpers";

export function startSubmittedTurn(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  setup: SubmitSetup,
): void {
  const { enqueueHarnessEvent, flushHarnessEvents } = ctx;
  const { editedResends, retiringTurns, turnGen, workspacePins } = ctx.refs;
  const { sessionId, text, attachments, options } = input;
  const {
    current,
    editedResend,
    handoffCard,
    initialWorkCwd,
    createDraftWorktree,
    harnessText,
    pendingSwitch,
  } = pre;
  const { gen, proposalId, queuedHandoff, launchTitleGeneration, turn } = setup;
  void (async () => {
    let workCwd = initialWorkCwd;
    if (createDraftWorktree) {
      const tree = await createWorktree(
        current.cwd,
        temporaryWorktreeBranchName(),
        current.worktreeBase || "HEAD",
        false,
      );
      workCwd = tree.path;
      workspacePins.current.set(sessionId, currentWorkspace(current.cwd));
      if (turn.proposalDraft)
        turn.proposalDraft = { ...turn.proposalDraft, checkoutCwd: tree.path };
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                worktreeCwd: tree.path,
                branch: tree.branch ?? undefined,
                workspaceMode: undefined,
                worktreeBase: undefined,
                worktreePreparing: undefined,
              }
            : session,
        ),
      );
      notifyReviewChanged(sessionId);

      const branchMessage = harnessText || attachments.map((file) => file.name).join(", ");
      void generateHarnessBranchName(pickTextHarness(current.harness), workCwd, branchMessage)
        .then(async (fragment) => {
          const branch = fragment ? namedWorktreeBranch(fragment) : null;
          if (!branch) return;
          const renamed = await renameWorktreeBranch(current.cwd, tree.path, branch);
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId && pathKey(sessionWorkCwd(session)) === pathKey(tree.path)
                ? { ...session, branch: renamed.branch ?? undefined }
                : session,
            ),
          );
        })
        .catch((error) => {
          console.warn("App operation failed", error);
        });
    }
    launchTitleGeneration(workCwd);
    if (turnGen.current.get(sessionId) !== gen) return;
    if (turn.proposalDraft && proposalId) {
      const settings = await discoverOrchestrationSettings();
      if (turnGen.current.get(sessionId) !== gen) return;
      turn.proposalDraft = { ...turn.proposalDraft, settings };
      const discovering = turn.proposalDraft;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? withOrchestrationProposal(session, proposalId, discovering)
            : session,
        ),
      );
    }
    turn.wrap = handoffCard
      ? {
          from: handoffCard.from,
          to: current.harness,
          text: handoffCard.brief,
        }
      : queuedHandoff;
    if (pendingSwitch) {
      let agentText = "";
      if (shouldAskOutgoingAgent(current) && isLiveHarness(pendingSwitch.from)) {
        try {
          agentText = await requestOutgoingHandoff({
            harness: pendingSwitch.from,
            sessionId,
            cwd: workCwd,
            model: pendingSwitch.fromModel,
            modelSettings: pendingSwitch.fromSettings,
            providerAccountId: pendingSwitch.fromProviderAccountId,
            userRequest: text,
          });
        } catch {
          agentText = "";
        }
      }
      if (turnGen.current.get(sessionId) !== gen) return;
      const latest = sessionsRef.current.find((s) => s.id === sessionId);
      const brief = chooseHandoffBrief(agentText, latest ?? current, text);
      await forgetHarnessSession(pendingSwitch.from, sessionId);
      if (turnGen.current.get(sessionId) !== gen) return;
      turn.wrap = { from: pendingSwitch.from, to: current.harness, text: brief };
    }
    const events = createSubmitTurnEvents(ctx, input, pre, setup, workCwd);

    turn.buildSucceeded = false;
    const checkpointTurnId = crypto.randomUUID();
    turn.checkpointStarted = false;
    turn.checkpointRetirementUncertain = false;
    await runSubmitDispatch(ctx, input, pre, setup, workCwd, checkpointTurnId, events);
  })()
    .catch((error: unknown) => {
      invalidateProjectLocation(current.cwd);
      turn.controlOutcome = {
        status: "failed",
        text: turn.controlText,
        error: error instanceof Error ? error.message : String(error),
      };
      if (turnGen.current.get(sessionId) === gen) {
        enqueueHarnessEvent(sessionId, {
          type: "session.error",
          message: turn.controlOutcome.error!,
        });
        flushHarnessEvents();
        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== sessionId || turnGen.current.get(sessionId) !== gen) return session;
            const stopped = {
              ...stopStreaming(session, Date.now(), true),
              worktreePreparing: undefined,
            };
            return proposalId && turn.proposalDraft
              ? withOrchestrationProposal(
                  stopped,
                  proposalId,
                  completeOrchestrationProposal(turn.proposalDraft, "", turn.controlOutcome.error),
                )
              : stopped;
          }),
        );
      }
    })
    .finally(() => {
      if (retiringTurns.current.get(sessionId) === gen) retiringTurns.current.delete(sessionId);
      editedResend?.reject();
      if (editedResend) editedResends.finish(sessionId);
      options?.onSettled?.(
        turnGen.current.get(sessionId) !== gen
          ? { status: "cancelled", text: turn.controlText }
          : turn.controlOutcome,
      );
    });
}
