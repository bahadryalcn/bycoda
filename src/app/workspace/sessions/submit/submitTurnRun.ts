import type { SubmitDeps, SubmitInput, SubmitPreflight, SubmitSetup } from "./submitTypes";
import { createSubmitTurnEvents } from "./submitTurnEvents";
import { runSubmitDispatch } from "./submitTurnDispatch";

import { discoverOrchestrationSettings } from "../../../../features/orchestration/model/orchestrationCatalog";
import {
  completeOrchestrationProposal,
  withOrchestrationProposal,
} from "../../../../features/orchestration/model/orchestrationPlan";
import { invalidateProjectLocation } from "../../../../features/projects/model/projectLocation";
import {
  endActiveSubmit,
  repairStaleHandoff,
} from "../../../../features/sessions/model/activeSubmits";
import { notifyReviewChanged } from "../../../../features/sessions/model/checkpoint";
import {
  chooseHandoffBrief,
  failHandoff,
  releaseHandoffSource,
  setPreparingHandoffBrief,
  shouldAskOutgoingAgent,
} from "../../../../features/sessions/model/handoff";
import { requestOutgoingHandoff } from "../../../../features/sessions/model/handoffTurn";
import { handoffContextSession } from "../../../../features/sessions/model/handoffBudget";
import {
  failedTurnQueueNotice,
  holdQueueAfterFailedTurn,
} from "../../../../features/sessions/model/messageQueue";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { prepareSessionWorkspaceDetailed } from "../../../../features/workspaces/model/sessionWorkspace";
import {
  forgetHarnessSession,
  isLiveHarness,
  stopStreaming,
} from "../../../../integrations/harness";
import { currentWorkspace } from "../../helpers/appHelpers";

export function startSubmittedTurn(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  setup: SubmitSetup,
): void {
  const { enqueueHarnessEvent, flushHarnessEvents } = ctx;
  const { editedResends, retiringTurns, turnGen, workspacePins } = ctx.refs;
  const { sessionId, text, options } = input;
  const { current, editedResend, handoffCard, initialWorkCwd, createDraftWorktree, pendingSwitch } =
    pre;
  const { gen, proposalId, queuedHandoff, launchTitleGeneration, turn } = setup;
  let outgoingRetired = false;
  void (async () => {
    let workCwd = initialWorkCwd;
    if (createDraftWorktree) {
      const { workspace, outcome } = await prepareSessionWorkspaceDetailed(current);
      if (turnGen.current.get(sessionId) !== gen) return;
      workCwd = workspace?.path ?? initialWorkCwd;
      workspacePins.current.set(sessionId, currentWorkspace(current.cwd));
      if (turn.proposalDraft) turn.proposalDraft = { ...turn.proposalDraft, checkoutCwd: workCwd };
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                ...(workspace
                  ? {
                      workspaceId: workspace.id,
                      workspaceRevision: workspace.revision,
                      worktreeCwd: workspace.path,
                      branch: workspace.branchRef.replace(/^refs\/heads\//, ""),
                    }
                  : {}),
                // "current" is recorded only when policy or the user chose it; a
                // legacy-Host fallback or an unneeded workspace leaves the mode alone.
                ...(outcome === "workspace"
                  ? { workspaceMode: undefined }
                  : outcome === "current"
                    ? { workspaceMode: "current" as const }
                    : {}),
                blocks: session.blocks.map((block) =>
                  block.workspacePreparationPending
                    ? { ...block, workspacePreparationPending: undefined }
                    : block,
                ),
                worktreeBase: undefined,
                worktreePreparing: undefined,
              }
            : session,
        ),
      );
      notifyReviewChanged(sessionId);
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
      if (!queuedHandoff && shouldAskOutgoingAgent(current) && isLiveHarness(pendingSwitch.from)) {
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
      const brief =
        queuedHandoff?.text ??
        chooseHandoffBrief(
          agentText,
          handoffContextSession(latest ?? current, text, input.attachments),
          text,
        );
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && turnGen.current.get(sessionId) === gen
            ? setPreparingHandoffBrief(session, brief)
            : session,
        ),
      );
      // Unverified retirement of the outgoing provider is a warning, not a reason to
      // drop the user's request; the switch completes and the request is sent once.
      await forgetHarnessSession(pendingSwitch.from, sessionId).catch((error) => {
        console.warn("App operation failed", error);
      });
      outgoingRetired = true;
      if (turnGen.current.get(sessionId) !== gen) return;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && turnGen.current.get(sessionId) === gen
            ? releaseHandoffSource(session)
            : session,
        ),
      );
      turn.wrap = {
        from: queuedHandoff?.from ?? pendingSwitch.from,
        to: current.harness,
        text: brief,
      };
    }
    const events = createSubmitTurnEvents(ctx, input, pre, setup, workCwd);

    turn.buildSucceeded = false;
    const checkpointTurnId = crypto.randomUUID();
    turn.checkpointStarted = false;
    turn.checkpointRetirementUncertain = false;
    await runSubmitDispatch(ctx, input, pre, setup, workCwd, checkpointTurnId, events);
  })()
    .catch((error: unknown) => {
      if (turn.replyCompleted) {
        // The reply is already complete: later cleanup trouble is a warning.
        console.warn("Post-turn cleanup failed", error);
        if (turnGen.current.get(sessionId) !== gen) return;
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "The reply finished, but cleanup afterwards did not complete.",
        });
        flushHarnessEvents();
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId && turnGen.current.get(sessionId) === gen
              ? { ...stopStreaming(session, Date.now()), worktreePreparing: undefined }
              : session,
          ),
        );
        return;
      }
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
        let queueHeld = false;
        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== sessionId || turnGen.current.get(sessionId) !== gen) return session;
            // The turn failed before or while it ran: queued follow-ups hold
            // for the owner instead of draining into the same failure.
            const streamingStopped = stopStreaming(session, Date.now(), true);
            const held = holdQueueAfterFailedTurn(streamingStopped);
            if (held !== streamingStopped) queueHeld = true;
            const stoppedTurn = {
              ...held,
              worktreePreparing: undefined,
            };
            const stopped = pendingSwitch
              ? failHandoff(
                  stoppedTurn,
                  outgoingRetired ? undefined : pendingSwitch,
                  turn.controlOutcome.error!,
                  outgoingRetired ? turn.wrap?.text : undefined,
                )
              : stoppedTurn;
            return proposalId && turn.proposalDraft
              ? withOrchestrationProposal(
                  stopped,
                  proposalId,
                  completeOrchestrationProposal(turn.proposalDraft, "", turn.controlOutcome.error),
                )
              : stopped;
          }),
        );
        if (queueHeld) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: failedTurnQueueNotice(turn.controlOutcome.error),
          });
          flushHarnessEvents();
        }
      }
    })
    .finally(() => {
      // A handoff still preparing here (Stop, a newer turn, an early exit) has no owner left.
      if (endActiveSubmit(sessionId, gen)) repairStaleHandoff(sessionId);
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
