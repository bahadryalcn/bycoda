import type { PreflightResult, SubmitDeps, SubmitInput } from "./submitTypes";

import { composeNoteMessage } from "../../../../features/notes";
import { orchestrator } from "../../../../features/orchestration/model/orchestration";
import { providerAccountExists, sessionProviderAccountId, supportsProviderAccounts } from "../../../../features/providers/model/providerAccounts";
import { createEditedResendAttempt } from "../../../../features/sessions/model/editLastTurn";
import { isPreparingHandoff } from "../../../../features/sessions/model/handoff";
import { queuedMessageForSubmit } from "../../../../features/sessions/model/messageQueue";
import { saveRecentModelChoice } from "../../../../features/sessions/model/models";
import { consumeOperatorCommand, operatorEnabledInThread } from "../../../../features/sessions/model/operatorCommand";
import { approvedPlanForMessage, isBuildablePlan } from "../../../../features/sessions/model/plan";
import { sessionWorkCwd } from "../../../../features/sessions/model/session";
import { sessionsRef } from "../../../../features/sessions/model/sessionsStore";
import { pendingShellRuns, withShellContext } from "../../../../features/sessions/model/shellRun";
import { isNativeCommandPrompt } from "../../../../features/skills/model/skills";
import { isEqualOrInside } from "../../../../shared/lib/paths";
import { withPlanBuildTarget } from "../../helpers/sessionHelpers";

export function prepareSubmitPreflight(ctx: SubmitDeps, input: SubmitInput): PreflightResult {
  const { workspaceNavigation, enqueueHarnessEvent, flushHarnessEvents, setProviderAccountRecovery } = ctx;
  const { editedResends, removingSessionIds, switchingWorktrees, removingWorktreePaths } = ctx.refs;
  const { sessionId, text, attachments, options } = input;
  if (editedResends.isActive(sessionId)) return { settled: true, value: false };
  // Apply received output and terminal state before reading the next turn.
  flushHarnessEvents();
  const controlError = orchestrator.submissionError(sessionId, options?.managed);
  if (controlError) {
    enqueueHarnessEvent(sessionId, { type: "status", text: controlError });
    flushHarnessEvents();
    return { settled: true, value: false };
  }
  if (options?.managed) {
    const target = sessionsRef.current.find((s) => s.id === sessionId);
    if (
      !target ||
      target.busy ||
      target.pendingSwitch ||
      isPreparingHandoff(target) ||
      removingSessionIds.current.has(sessionId)
    ) {
      options.onSettled?.({
        status: "failed",
        text: "",
        error: "Session is unavailable or already running",
      });
      return { settled: true, value: false };
    }
  }
  if (
    removingSessionIds.current.has(sessionId) ||
    switchingWorktrees.current.has(sessionId) ||
    workspaceNavigation.isSwitching(sessionId)
  )
    return { settled: true, value: false };
  const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
  if (options?.appRequestId && storedCurrent?.busy) return { settled: true, value: false };
  if (
    options?.ciRepair &&
    storedCurrent &&
    (storedCurrent.busy || storedCurrent.pendingSwitch || isPreparingHandoff(storedCurrent))
  )
    return { settled: true, value: false };
  if (
    !storedCurrent ||
    storedCurrent.worktreeRemoved ||
    [...removingWorktreePaths.current].some((path) =>
      isEqualOrInside(sessionWorkCwd(storedCurrent), path),
    )
  )
    return { settled: true, value: false };
  const draftBlock = options?.draftBlockId
    ? storedCurrent.blocks.find(
        (block) => block.id === options.draftBlockId && block.role === "user" && block.draft,
      )
    : undefined;
  if (options?.draftBlockId && !draftBlock) return { settled: true, value: false };
  const draftCleared = draftBlock
    ? {
        ...storedCurrent,
        blocks: storedCurrent.blocks.filter((block) => block.id !== draftBlock.id),
      }
    : storedCurrent;
  let current = options?.buildTarget
    ? withPlanBuildTarget(draftCleared, options.buildTarget)
    : draftCleared;
  const queuedMessage = options?.queuedMessageId
    ? queuedMessageForSubmit(
        current,
        options.queuedMessageId,
        options.followUpBehavior === "steer" ? "steer" : "dispatch",
      )
    : undefined;
  if (options?.queuedMessageId && !queuedMessage) return { settled: true, value: false };
  const submitTarget = queuedMessage?.modelTarget ?? options?.buildTarget;
  if (queuedMessage?.modelTarget) {
    current =
      current.busy && options?.followUpBehavior === "steer"
        ? { ...current, ...queuedMessage.modelTarget }
        : withPlanBuildTarget(current, queuedMessage.modelTarget);
  }
  const editedResend = options?.resendEdited
    ? createEditedResendAttempt(current, options.onResendRejected)
    : undefined;
  if (options?.resendEdited && !editedResend) return { settled: true, value: false };
  const editedProviderTurnId = editedResend?.providerTurnId;
  if (editedResend) {
    current = { ...current, blocks: editedResend.blocks };
  }
  const messagePlan = (options?.intent ?? "default") === "default" &&
    !options?.managed && !options?.resendEdited && !options?.ciRepair &&
    !current.inboxAsk && !orchestrator.forSession(sessionId) && attachments.length === 0
      ? approvedPlanForMessage(current, text)
      : undefined;
  const intent = messagePlan ? "build" : options?.intent ?? "default";
  if (intent === "orchestrate") {
    try {
      const run = orchestrator.forSession(sessionId);
      if (run && ["active", "paused"].includes(run.status))
        throw new Error(
          "Stop the current orchestration run before preparing another proposal.",
        );
    } catch (error) {
      enqueueHarnessEvent(sessionId, {
        type: "status",
        text: error instanceof Error ? error.message : String(error),
      });
      flushHarnessEvents();
      return { settled: true, value: false };
    }
  }
  const approvedPlan = options?.planBlockId
    ? current.blocks.find((block) => block.id === options.planBlockId && block.role === "plan")
    : messagePlan;
  if (intent === "build" && (!approvedPlan || current.busy || !isBuildablePlan(approvedPlan)))
    return { settled: true, value: false };
  if (options?.queuedMessageId) {
    const mode = options.followUpBehavior === "steer" ? "steer" : "dispatch";
    if (!queuedMessageForSubmit(current, options.queuedMessageId, mode)) {
      return { settled: true, value: false };
    }
  }
  const noteCard = options && "noteCard" in options ? options.noteCard : current.noteCard;
  const handoffCard =
    options && "handoffCard" in options ? options.handoffCard : current.handoffCard;
  if (!text.trim() && attachments.length === 0 && !noteCard && !handoffCard) {
    return { settled: true, value: false };
  }
  if (isPreparingHandoff(current)) return { settled: true, value: false };
  saveRecentModelChoice(current.harness, current.model);
  const initialWorkCwd = sessionWorkCwd(current);
  const createDraftWorktree = !current.worktreeCwd && current.workspaceMode === "worktree";
  const accountProvider = supportsProviderAccounts(current.harness)
    ? current.harness
    : undefined;
  const providerAccountId = accountProvider
    ? sessionProviderAccountId(accountProvider, current)
    : undefined;
  if (
    accountProvider &&
    providerAccountId &&
    !providerAccountExists(accountProvider, providerAccountId)
  ) {
    setProviderAccountRecovery({ sessionId, provider: accountProvider });
    return { settled: true, value: false };
  }
  const submittedText = intent === "build" ? "Build approved plan" : text;
  const operatorCommand = consumeOperatorCommand(submittedText);
  if (
    operatorCommand.matched &&
    (intent !== "default" ||
      current.orchestrationLeadId ||
      current.inboxAsk ||
      orchestrator.run(sessionId))
  ) {
    enqueueHarnessEvent(sessionId, {
      type: "status",
      text: "Use /operator from a regular session turn, outside an orchestration run.",
    });
    flushHarnessEvents();
    return { settled: true, value: false };
  }
  const operatorAccess = operatorCommand.matched || operatorEnabledInThread(current.blocks);
  const promptText = operatorCommand.matched
    ? operatorCommand.text.trim() || "Explain what you can do in bycoda with the app CLI."
    : submittedText;
  const rawCommand =
    !operatorCommand.matched && isNativeCommandPrompt(submittedText, current.harness);
  const ciContext = options?.ciRepair?.prompt ?? options?.ciContext;
  // The `!commands` run since the last message go with this one, to the
  // harness only; a native command has to arrive exactly as typed.
  const harnessText =
    options?.ciRepair?.prompt ??
    (rawCommand
      ? submittedText
      : withShellContext(
          pendingShellRuns(current.blocks),
          composeNoteMessage(noteCard, promptText),
        ));

  const pendingSwitch =
    current.pendingSwitch && current.pendingSwitch.from !== current.harness
      ? current.pendingSwitch
      : null;
  return {
    settled: false,
    pre: {
      storedCurrent, draftBlock, current, submitTarget, editedResend, editedProviderTurnId, intent,
      approvedPlan, noteCard, handoffCard, providerAccountId, initialWorkCwd, createDraftWorktree,
      submittedText, operatorCommand, operatorAccess, promptText, rawCommand, ciContext, harnessText,
      pendingSwitch,
    },
  };
}

