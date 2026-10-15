import type { SetupResult, SubmitDeps, SubmitInput, SubmitPreflight, SubmitTurn } from "./submitTypes";

import { syncDockBadge } from "../../../../features/notifications/model/dockBadge";
import { proposalBlock, type OrchestrationProposal } from "../../../../features/orchestration/model/orchestrationPlan";
import { sessionProviderAccountId, supportsProviderAccounts } from "../../../../features/providers/model/providerAccounts";
import { displayAttachments } from "../../../../features/sessions/model/attachments";
import { appendPreparingHandoff, handoffTurnCard, pendingHandoff } from "../../../../features/sessions/model/handoff";
import { queuedModelTarget, sentQueuedMessage } from "../../../../features/sessions/model/messageQueue";
import { resolveModel } from "../../../../features/sessions/model/models";
import { SECOND_OPINION_TITLE } from "../../../../features/sessions/model/secondOpinion";
import { HARNESS_LABEL, canReplaceSessionTitle, formatSessionTitle, titleFromPrompt, type Session } from "../../../../features/sessions/model/session";
import { shouldGenerateSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { resolveLinkedWorkItem } from "../../../../features/sessions/model/sessionWorkItem";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { appendUser, canRewindHarnessLastTurn, cancelHarnessTurn, forgetHarnessSession, generateHarnessTitle, isLiveHarness, stopStreaming } from "../../../../integrations/harness";
import { t } from "../../../../shared/i18n";
import { beginSessionPerformanceTrace, recordPerformanceEvent } from "../../../../shared/lib/performanceTrace";
import { userTurnCards, withPlanBuildTarget } from "../../helpers/sessionHelpers";
import { flushSync } from "react-dom";

export function prepareSubmittedTurn(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
): SetupResult {
  const { dismissNoticesForContinuedSession } = ctx;
  const { editedResends, turnGen } = ctx.refs;
  const { sessionId, attachments, options } = input;
  const { draftBlock, current, submitTarget, editedResend, intent, approvedPlan, noteCard, handoffCard, providerAccountId, initialWorkCwd, createDraftWorktree, submittedText, operatorCommand, promptText, rawCommand, ciContext, harnessText, pendingSwitch } = pre;

  const traceId = beginSessionPerformanceTrace(sessionId);
  recordPerformanceEvent("send-prepare", { phase: 0 }, traceId);
  const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
  turnGen.current.set(sessionId, gen);
  const proposalId = intent === "orchestrate" ? crypto.randomUUID() : undefined;
  // Turn state that later phases read and write (formerly the `let`s of the
  // submit body). Initial values are the original declarations' initializers.
  const initialProposalDraft: OrchestrationProposal | undefined = proposalId
    ? {
        version: 1,
        leadId: sessionId,
        cwd: current.cwd,
        checkoutCwd: initialWorkCwd,
        request: harnessText,
        author: {
          harness: current.harness,
          model: current.model,
          name: resolveModel(current.harness, current.model).name,
        },
        settings: { choices: [], maxWorkers: 2 },
        status: "planning",
        get title() {
          return t("Orchestration plan");
        },
        summary: "",
        tasks: [],
      }
    : undefined;
  const turn: SubmitTurn = {
    proposalDraft: initialProposalDraft,
    controlOutcome: {
      status: "failed",
      text: "",
      error: "Turn did not complete",
    },
    controlText: "",
    proposalText: "",
    nativeProposalText: "",
    completedProposal: undefined,
    wrap: null,
    nativePlanSeen: false,
    providerFailureSeen: false,
    buildSucceeded: false,
    checkpointStarted: false,
    checkpointRetirementUncertain: false,
    sawProviderEvent: false,
    contextReplayAccepted: false,
  };
  const isFirstTurn = current.blocks.length === 0;
  const placeholderTitle =
    canReplaceSessionTitle(current.title, current.harness, HARNESS_LABEL[current.harness]) ||
    !!draftBlock;
  const titleSeed =
    isFirstTurn && !current.inboxCard && !current.noteCard && placeholderTitle
      ? titleFromPrompt(
          operatorCommand.matched ? promptText : submittedText,
          current.harness,
          attachments,
        )
      : current.title;
  const visible = displayAttachments(attachments);
  const card =
    options?.secondOpinion ?? (handoffCard ? handoffTurnCard(handoffCard) : undefined);
  const visibleText = operatorCommand.matched
    ? promptText
    : card?.kind === "handoff"
      ? submittedText
      : card
        ? SECOND_OPINION_TITLE
        : submittedText;
  const cards = {
    ...(rawCommand ? undefined : userTurnCards(noteCard, card)),
    ...(ciContext ? { ciContext } : {}),
    ...(operatorCommand.matched ? { bycoda: true } : {}),
    ...(intent === "plan" || intent === "orchestrate" ? { intent } : {}),
    ...(options?.appRequestId ? { appRequestId: options.appRequestId } : {}),
    // The orchestrator writes these turns, not the user; hide them.
    ...(options?.managed ? { internal: true } : {}),
  };
  const live = isLiveHarness(current.harness);
  const queuedHandoff = live && !pendingSwitch ? pendingHandoff(current) : null;

  if (pendingSwitch && current.busy) {
    void cancelHarnessTurn(pendingSwitch.from, sessionId);
  }

  dismissNoticesForContinuedSession(sessionId);
  const commitSubmittedTurn = () => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const draftRemoved = draftBlock
          ? {
              ...s,
              blocks: s.blocks.filter((block) => block.id !== draftBlock.id),
            }
          : s;
        const selected = submitTarget
          ? withPlanBuildTarget(draftRemoved, submitTarget)
          : draftRemoved;
        const titled = isFirstTurn ? titleSeed : selected.title;
        let next: Session = {
          ...selected,
          runningModelTarget: {
            ...queuedModelTarget(current),
            providerAccountId: supportsProviderAccounts(current.harness)
              ? sessionProviderAccountId(current.harness, current)
              : undefined,
          },
          providerAccountId,
          usageLimit: undefined,
          worktreePreparing: createDraftWorktree ? true : selected.worktreePreparing,
          inboxCard: rawCommand || options?.ciRepair ? s.inboxCard : undefined,
          noteCard: rawCommand || options?.ciRepair ? s.noteCard : undefined,
          handoffCard: rawCommand || options?.ciRepair ? s.handoffCard : undefined,
        };
        if (editedResend) {
          next = editedResend.replace(next);
        }
        if (approvedPlan && intent === "build") {
          next = {
            ...next,
            blocks: next.blocks.map((block) =>
              block.id === approvedPlan.id && block.role === "plan"
                ? {
                    ...block,
                    plan: {
                      ...(block.plan ?? { status: "ready" as const }),
                      status: "building" as const,
                      approvedText: block.text,
                    },
                  }
                : block,
            ),
          };
        }
        if (options?.queuedMessageId) {
          next = sentQueuedMessage(next, options.queuedMessageId);
        }
        if (!live) {
          return {
            ...next,
            title: titled,
            pendingSwitch: undefined,
            busy: false,
            blocks: [
              ...next.blocks,
              {
                id: crypto.randomUUID(),
                role: "user",
                text: visibleText,
                ...(visible.length > 0 ? { attachments: visible } : {}),
                ...cards,
              },
              {
                id: crypto.randomUUID(),
                role: "system",
                text: `${next.harness} is not connected yet — install and sign in to that provider, then retry.`,
                notice: "error",
              },
            ],
          };
        }
        if (pendingSwitch) {
          const sealed = stopStreaming({
            ...next,
            title: titled,
            pendingSwitch: undefined,
          });
          return appendUser(
            appendPreparingHandoff(sealed, pendingSwitch.from, next.harness),
            visibleText,
            visible,
            cards,
          );
        }
        return appendUser({ ...next, title: titled }, visibleText, visible, cards);
      }),
    );
  };
  if (!options?.resendEdited) {
    flushSync(commitSubmittedTurn);
  }

  const launchTitleGeneration = (workCwd: string) => {
    if (
      !live ||
      !shouldGenerateSessionTitle(isFirstTurn, placeholderTitle, options?.refreshTitle)
    ) {
      return;
    }
    const titleMessage = harnessText || attachments.map((file) => file.name).join(", ");
    void generateHarnessTitle(current.harness, {
      sessionId,
      cwd: workCwd,
      message: titleMessage,
      providerAccountId,
    })
      .then(async (generated) => {
        if (options?.refreshTitle && !isFirstTurn && turnGen.current.get(sessionId) !== gen) {
          return;
        }
        const linkedWorkItem = await resolveLinkedWorkItem(
          titleMessage,
          workCwd,
          generated?.workItem ?? null,
        );
        if (!generated && !linkedWorkItem) return;
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            let next = s;
            if (
              generated &&
              (options?.refreshTitle || canReplaceSessionTitle(s.title, s.harness, titleSeed))
            ) {
              next = {
                ...next,
                title: formatSessionTitle(s.harness, generated.title),
              };
            }
            if (linkedWorkItem && !next.linkedWorkItem) {
              next = { ...next, linkedWorkItem };
            }
            return next;
          }),
        );
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
  };

  if (!live) {
    if (pendingSwitch) {
      void forgetHarnessSession(pendingSwitch.from, sessionId);
    }
    editedResend?.reject();
    options?.onSettled?.({
      status: "failed",
      text: "",
      error: "Harness is not connected",
    });
    return { settled: true, value: true };
  }
  if (editedResend && canRewindHarnessLastTurn(current.harness)) {
    editedResends.start(sessionId);
    const locked = sessionsRef.current.map((session) =>
      session.id === sessionId ? { ...session, busy: true } : session,
    );
    sessionsRef.current = locked;
    syncDockBadge(locked);
    setSessions(locked);
  }

  if (proposalId && turn.proposalDraft) {
    const draft = turn.proposalDraft;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              blocks: [...session.blocks, proposalBlock(proposalId, draft)],
            }
          : session,
      ),
    );
  }

  return { settled: false, setup: { traceId, gen, proposalId, queuedHandoff, commitSubmittedTurn, launchTitleGeneration, turn } };
}

