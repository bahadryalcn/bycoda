import type { SubmitDeps, SubmitInput, SubmitPreflight, SubmitSetup } from "./submitTypes";
import type { SubmitTurnEvents } from "./submitTurnEvents";

import { inboxAskPrompt } from "../../../../features/inbox/model/inboxAsk";
import { announceSessionFinished } from "../../../../features/notifications/model/notifications";
import { orchestrator, shellPath } from "../../../../features/orchestration/model/orchestration";
import { completeOrRepairOrchestrationProposal, completeOrchestrationProposal, orchestrationPlanningPrompt, orchestrationRepairPrompt, withOrchestrationProposal } from "../../../../features/orchestration/model/orchestrationPlan";
import { prepareAttachments } from "../../../../features/sessions/model/attachments";
import { beginSessionTurn, finishSessionTurn, flushSessionCheckpoint } from "../../../../features/sessions/model/checkpoint";
import { completeHandoff, consumeHandoff, isPreparingHandoff, userMessagesAfterHandoff, wrapHandoffPrompt } from "../../../../features/sessions/model/handoff";
import { CONTINUE_PROMPT } from "../../../../features/sessions/model/inFlight";
import { buildPlanPrompt, isProviderFailureText, planTurnPrompt } from "../../../../features/sessions/model/plan";
import { preparePrompt } from "../../../../features/sessions/model/promptPreparation";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { canRewindHarnessLastTurn, forgetHarnessSession, promoteLastAssistantToPlan, rewindHarnessLastTurn, sendHarnessTurn, stopHarnessSession, stopStreaming } from "../../../../integrations/harness";
import { recordPerformanceEvent, startPerformanceSpan } from "../../../../shared/lib/performanceTrace";
import { finalizeLocalTurn } from "../../../model/localTurnFinalization";
import { prepareLocalTurn } from "../../../model/localTurnPreparation";
import { prepareBudgetedHandoff } from "../../../model/prepareHandoff";
import { lastAssistantTextInTurn, withPlanStatus } from "../../helpers/sessionHelpers";
import { notifyFinishedWorkspace } from "../../helpers/workspaceNotify";
import { invoke } from "@tauri-apps/api/core";
import { detachSessionWorktree, worktreeDeletedExternally } from "../../../../features/source-control/model/worktrees";
import { isRemoteProjectPath } from "../../../../features/projects/model/recents";

export async function runSubmitDispatch(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  setup: SubmitSetup,
  workCwd: string,
  checkpointTurnId: ReturnType<typeof crypto.randomUUID>,
  events: SubmitTurnEvents,
): Promise<void> {
  const { sessionId, attachments, options } = input;
  const { enqueueHarnessEvent, flushHarnessEvents, deferWorkspaceWork } = ctx;
  const { retiringTurns, turnGen, activeSessionIdRef } = ctx.refs;
  const { current, editedResend, editedProviderTurnId, intent, approvedPlan, providerAccountId, operatorCommand, operatorAccess, rawCommand, harnessText } = pre;
  const { traceId, gen, proposalId, queuedHandoff, turn } = setup;
  const { revealHandoff, routeTurnEvent, acceptContextReplay, acceptEditedResend, recoverEditedResend, contextReplay, planEventKey } = events;
  try {
    const preparation = await prepareLocalTurn({
      traceId,
      checkpoint: () =>
        !current.inboxAsk && !orchestrator.forSession(sessionId)
          ? (turn.checkpointStarted = true, beginSessionTurn(sessionId, workCwd, checkpointTurnId)).catch((error) => {
              if (String(error).includes("checkpoint-coordination:")) throw error;
              console.warn("App operation failed", error);
            })
          : Promise.resolve(),
      attachments: () => prepareAttachments(attachments),
      prompt: () =>
        intent === "build" && approvedPlan
          ? Promise.resolve(buildPlanPrompt(approvedPlan.text))
          : preparePrompt(harnessText, { harness: current.harness, sessionId, cwd: workCwd }),
      isCurrent: () => turnGen.current.get(sessionId) === gen,
    });
    if (!preparation) return;
    const { attachments: prepared, prompt } = preparation;
    const turnPrompt = turn.proposalDraft
      ? options?.orchestrationRetry?.response
        ? orchestrationRepairPrompt({
            ...turn.proposalDraft,
            error: options.orchestrationRetry.error,
            response: options.orchestrationRetry.response,
          })
        : orchestrationPlanningPrompt(
            prompt,
            turn.proposalDraft.settings,
            turn.proposalDraft.checkoutCwd ?? turn.proposalDraft.cwd,
          )
      : intent === "plan" && !rawCommand
        ? planTurnPrompt(prompt)
        : prompt;
    const earlier = queuedHandoff ? userMessagesAfterHandoff(current) : [];
    if (editedResend && canRewindHarnessLastTurn(current.harness)) {
      try {
        await rewindHarnessLastTurn({
          harness: current.harness,
          sessionId,
          cwd: workCwd,
          model: current.model,
          modelSettings: current.modelSettings,
          runtimeMode: current.runtimeMode,
          ...(editedProviderTurnId ? { providerTurnId: editedProviderTurnId } : {}),
          onEvent: (event) => {
            if (turnGen.current.get(sessionId) !== gen) return;
            enqueueHarnessEvent(sessionId, event);
          },
        });
      } catch (error) {
        flushHarnessEvents();
        editedResend.reject();
        throw error;
      }
      editedResend.markProviderRewound();
      flushHarnessEvents();
      if (turnGen.current.get(sessionId) !== gen) {
        const latest = sessionsRef.current.find((session) => session.id === sessionId);
        if (
          !latest ||
          (!latest.busy && latest.providerSessionId === current.providerSessionId)
        ) {
          await forgetHarnessSession(current.harness, sessionId);
          if (latest) {
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId &&
                session.providerSessionId === current.providerSessionId
                  ? { ...session, providerSessionId: undefined }
                  : session,
              ),
            );
          }
        }
        recoverEditedResend();
        return;
      }
    }
    const sendTurn = (text: string, turnAttachments = prepared) => {
      if (turnGen.current.get(sessionId) !== gen) return Promise.resolve();
      recordPerformanceEvent("dispatch", {}, traceId);
      const finishDispatch = startPerformanceSpan("dispatch", {}, traceId);
      return sendHarnessTurn({
        harness: current.harness,
        sessionId,
        cwd: workCwd,
        model: current.model,
        modelSettings: current.modelSettings,
        providerAccountId,
        runtimeMode: current.runtimeMode,
        intent: intent === "orchestrate" ? "plan" : intent,
        // A /operator user turn enables app access for this thread;
        // orchestration leads retain their separate control access.
        controlsAgents: operatorAccess || orchestrator.run(sessionId)?.status === "active",
        appAccess: operatorAccess,
        text: !turn.contextReplayAccepted ? `${contextReplay}\n\nCurrent user request:\n${text}` : text,
        attachments: turnAttachments,
        onAccepted: () => {
          acceptContextReplay();
          acceptEditedResend();
        },
        onEvent: routeTurnEvent,
      }).finally(finishDispatch);
    };
    if (turn.wrap && !rawCommand) {
      const historySession =
        sessionsRef.current.find((session) => session.id === sessionId) ?? current;
      const budgeted = await prepareBudgetedHandoff(
        { ...historySession, model: current.model, harness: current.harness },
        turn.wrap.text,
        [turnPrompt.trim() || CONTINUE_PROMPT, ...earlier].join("\n\n"),
      );
      if (turnGen.current.get(sessionId) !== gen) return;
      turn.wrap = { ...turn.wrap, text: budgeted };
    }
    let sendText = orchestrator.prompt(
      sessionId,
      inboxAskPrompt(
        rawCommand ? undefined : current.inboxAsk,
        turn.wrap && !rawCommand
          ? wrapHandoffPrompt(
              turn.wrap.text,
              turn.wrap.from,
              turnPrompt.trim() || CONTINUE_PROMPT,
              earlier,
              turn.wrap.to,
            )
          : turnPrompt,
      ),
    );
    if (operatorCommand.matched) {
      const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
      sendText += `\n\n<bycoda_app>\nThe user's Operator command enables app access in this thread, including later turns without the command. You can start session tabs or split session panes right or down, list and create project worktrees, choose a new session's checkout, read and continue other project sessions, save unsent drafts, organize session folders, and read or write saved notes through its local CLI. Run \`${cli} --help\` for exact commands and JSON fields, then use it as needed for the user's request. After sessions.send, call sessions.wait with the returned requestId as sentRequestId to get that session's reply. When reading another session, start with its latest two or three user/assistant exchanges. Request older exchanges with nextBefore or a larger excerpt only if needed. The CLI uses a session credential already in your environment; never print it. New sessions inherit this session's permission mode unless runtimeMode is set explicitly. For a new session with a draft, call sessions.start with its prompt and draft:true; do not submit a seed prompt. The returned ID can be used as besideSessionId to split its pane again or moved into a folder immediately. A normal sessions.start submits its prompt but returns after acceptance, so do not wait for that agent to finish before organizing it.\n</bycoda_app>`;
    }
    await sendTurn(sendText);
    if (!turn.providerFailureSeen) acceptContextReplay();
    acceptEditedResend();
    if (turn.proposalDraft && !turn.providerFailureSeen) {
      turn.completedProposal = await completeOrRepairOrchestrationProposal(
        turn.proposalDraft,
        turn.nativeProposalText || turn.proposalText,
        async (repairPrompt) => {
          turn.proposalText = "";
          turn.nativeProposalText = "";
          await sendTurn(repairPrompt, []);
          if (turn.providerFailureSeen)
            throw new Error(
              turn.controlOutcome.error ?? "The lead could not repair the proposal.",
            );
          return turn.nativeProposalText || turn.proposalText;
        },
        () =>
          turnGen.current.get(sessionId) === gen &&
          !isProviderFailureText(turn.nativeProposalText || turn.proposalText),
      );
    }
    if (turnGen.current.get(sessionId) !== gen) return;
    if (turn.wrap) {
      const deliveredHandoff = turn.wrap;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const ready = isPreparingHandoff(s) ? completeHandoff(s, deliveredHandoff.text) : s;
          // A command owns its arguments; deliver the recap with the next chat prompt.
          return rawCommand ? ready : consumeHandoff(ready);
        }),
      );
    }
    turn.buildSucceeded = true;
  } catch (error: unknown) {
    recoverEditedResend();
    if (turnGen.current.get(sessionId) !== gen) return;
    if (turn.wrap) revealHandoff(turn.wrap.text);
    const message =
      error instanceof Error
        ? error.message
        : String(error) || `${current.harness} adapter failed`;
    turn.controlOutcome.error = message;
    retiringTurns.current.set(sessionId, gen);
    if (!turn.providerFailureSeen) {
      enqueueHarnessEvent(sessionId, {
        type: "session.error",
        message,
      });
    }
    turn.providerFailureSeen = true;
  } finally {
    flushHarnessEvents();
    turn.controlOutcome = {
      status:
        turn.providerFailureSeen || isProviderFailureText(turn.controlText) || !turn.buildSucceeded
          ? "failed"
          : "completed",
      text: turn.controlText.trim(),
      ...(turn.providerFailureSeen ? { error: turn.controlOutcome.error } : {}),
    };
    // A failed provider can leave its process alive with a dead event
    // stream or poisoned turn state. Park it now; the next prompt will
    // reconnect and resume through a fresh transport.
    const finalizedCurrentTurn = await finalizeLocalTurn({
      isCurrent: () => turnGen.current.get(sessionId) === gen,
      retire: () =>
        turn.providerFailureSeen || turnGen.current.get(sessionId) !== gen
          ? stopHarnessSession(current.harness, sessionId).catch(() => { turn.checkpointRetirementUncertain = true; })
          : Promise.resolve(),
      settle: () => turn.checkpointStarted
        ? finishSessionTurn(sessionId, workCwd, checkpointTurnId, turn.checkpointRetirementUncertain).catch((error) => console.warn("Workspace checkpoint failed", error))
        : Promise.resolve(),
      checkpoint: () => flushSessionCheckpoint(sessionId),
      commit: () =>
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId || turnGen.current.get(sessionId) !== gen) return s;
            const stopped = stopStreaming(s);
            const providerFailed =
              turn.providerFailureSeen || isProviderFailureText(lastAssistantTextInTurn(stopped));
            const finalized =
              turn.proposalDraft && proposalId
                ? withOrchestrationProposal(
                    stopped,
                    proposalId,
                    turn.completedProposal && !providerFailed && turn.buildSucceeded
                      ? turn.completedProposal
                      : completeOrchestrationProposal(
                          turn.proposalDraft,
                          turn.nativeProposalText || turn.proposalText,
                          providerFailed || !turn.buildSucceeded
                            ? (turn.controlOutcome.error ?? "The lead could not finish planning.")
                            : undefined,
                        ),
                  )
                : intent === "plan" && !turn.nativePlanSeen && !providerFailed
                  ? promoteLastAssistantToPlan(stopped, planEventKey)
                  : stopped;
            return approvedPlan && intent === "build"
              ? withPlanStatus(
                  finalized,
                  approvedPlan.id,
                  turn.buildSucceeded && !providerFailed ? "built" : "ready",
                )
              : finalized;
          }),
        ),
    });
    if (finalizedCurrentTurn) {
      const worktreePath = current.worktreeCwd;
      if (turn.providerFailureSeen && worktreePath && !isRemoteProjectPath(current.cwd)) {
        void worktreeDeletedExternally(worktreePath)
          .then((deleted) => {
            if (!deleted || ctx.refs.switchingWorktrees.current.has(sessionId) || turnGen.current.get(sessionId) !== gen) return;
            setSessions((prev) => prev.map((session) =>
              session.id === sessionId && !session.busy && !session.worktreeRemoved && session.worktreeCwd === worktreePath
                ? detachSessionWorktree(session, session.cwd, worktreePath)
                : session,
            ));
          })
          // An inaccessible checkout must never be mistaken for a deleted one.
          .catch(() => {});
      }
      // Next tick: the flush above has rendered by then, so the banner
      // quotes the reply's final text rather than the previous batch.
      deferWorkspaceWork(() => {
        if (turnGen.current.get(sessionId) !== gen) return;
        const finished = sessionsRef.current.find((s) => s.id === sessionId);
        const visible = sessionId === activeSessionIdRef.current;
        if (finished) void announceSessionFinished(finished, visible);
      }, 0);
      notifyFinishedWorkspace(sessionId, workCwd, deferWorkspaceWork, "git-first");
    }
  }
}

