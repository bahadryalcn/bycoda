import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import {
  blockingUsageBudgets,
  createBudgetReader,
} from "../../../../features/usage/model/usageBudgetReadings";
import {
  holdUndeliveredFollowUp,
  queuedModelTarget,
} from "../../../../features/sessions/model/messageQueue";
import { getSessions, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { t } from "../../../../shared/i18n";
import { beginSendStarting, claimStartingGeneration } from "./submitStarting";
import { showSubmitNotice } from "./submitNotice";
import type { Session } from "../../../../features/sessions/model/session";

function holdRejectedQueuedHead(session: Session, messageId: string | undefined): Session {
  return messageId && session.queuedMessages?.[0]?.id === messageId
    ? { ...session, queueStatus: "paused" }
    : session;
}

/**
 * A budget the user set to block stops a send only when its usage is known to
 * be over the limit. A reading that cannot be verified, or a scan that takes
 * longer than this, warns and lets the message go out.
 */
export const USAGE_CHECK_WAIT_MS = 3000;

type BudgetCheck = { exceeded?: { label: string }; unverified?: { label: string } };

async function checkSendBudgets(session: Session): Promise<BudgetCheck> {
  const matching = blockingUsageBudgets(session);
  if (!matching.length) return {};
  const reader = createBudgetReader(
    matching.some((budget) => budget.scope === "machine")
      ? [...getSessions().filter((current) => current.id !== session.id), session]
      : [session],
  );
  const read = Promise.all(
    matching.map(async (budget) => ({ budget, reading: await reader(budget) })),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const readings = await Promise.race([
      read,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), USAGE_CHECK_WAIT_MS);
      }),
    ]);
    if (!readings) return { unverified: { label: matching[0].label } };
    const exceeded = readings.find(({ reading }) => reading.state === "exceeded");
    if (exceeded) return { exceeded: { label: exceeded.budget.label } };
    const unknown = readings.find(({ reading }) => reading.state === "unknown");
    return unknown ? { unverified: { label: unknown.budget.label } } : {};
  } catch {
    return { unverified: { label: matching[0].label } };
  } finally {
    clearTimeout(timer);
  }
}

const pendingChecks = new Map<string, number>();
export function isUsageBudgetChecking(sessionId: string, generation: number | undefined): boolean {
  return pendingChecks.get(sessionId) === (generation ?? 0);
}

/** Validate before committing a user turn, title generation, worktrees or provider calls. */
export function gateUsageBudget(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  dispatch: () => SubmissionAcceptance,
): SubmissionAcceptance | undefined {
  try {
    if (!blockingUsageBudgets(pre.current).length) return undefined;
  } catch (error) {
    setSessions((all) =>
      all.map((s) =>
        s.id === input.sessionId ? holdRejectedQueuedHead(s, input.options?.queuedMessageId) : s,
      ),
    );
    ctx.enqueueHarnessEvent(input.sessionId, { type: "session.error", message: String(error) });
    ctx.flushHarnessEvents();
    input.options?.onSettled?.({ status: "failed", text: "", error: String(error) });
    return false;
  }
  const { sessionId, options } = input;
  // A running turn that this send replaces keeps its own generation and busy state.
  const { gen, isCurrent } = claimStartingGeneration(ctx, sessionId, pre.current.busy);
  pendingChecks.set(sessionId, gen);
  // Busy and "preparing": Stop works and a second message is queued, not lost.
  const sending = beginSendStarting(ctx, sessionId, !!pre.current.busy);
  let accepted = false;
  const release = (rejected = false) => {
    if (isCurrent() && rejected)
      setSessions((all) =>
        all.map((s) => (s.id === sessionId ? holdRejectedQueuedHead(s, options?.queuedMessageId) : s)),
      );
    sending.release(isCurrent());
  };
  return (async () => {
    try {
      const checked = await checkSendBudgets(pre.current);
      if (!isCurrent()) return false;
      if (checked.exceeded)
        throw new Error(
          `${t("Usage budget")}: ${checked.exceeded.label}. ${t(
            "Budget reached. Edit or remove the budget in Usage settings to continue.",
          )}`,
        );
      if (checked.unverified)
        showSubmitNotice(
          sessionId,
          t(
            "Usage budget: {p0}. Usage could not be verified, so the message was sent anyway. Check Usage settings.",
            { p0: checked.unverified.label },
          ),
        );
      const latest = getSessions().find((s) => s.id === sessionId);
      if (
        !latest ||
        latest.harness !== pre.storedCurrent.harness ||
        latest.model !== pre.storedCurrent.model ||
        latest.cwd !== pre.storedCurrent.cwd ||
        latest.providerAccountId !== pre.storedCurrent.providerAccountId ||
        latest.worktreeCwd !== pre.storedCurrent.worktreeCwd ||
        latest.runtimeMode !== pre.storedCurrent.runtimeMode ||
        JSON.stringify(latest.modelSettings) !== JSON.stringify(pre.storedCurrent.modelSettings)
      ) {
        throw new Error(t("Session changed while checking its usage budget. Try again."));
      }
      release();
      accepted = await dispatch();
      return accepted;
    } catch (error) {
      if (!isCurrent()) return false;
      const message = error instanceof Error ? error.message : String(error);
      ctx.enqueueHarnessEvent(sessionId, { type: "session.error", message });
      ctx.flushHarnessEvents();
      options?.onSettled?.({ status: "failed", text: "", error: message });
      return false;
    } finally {
      if (pendingChecks.get(sessionId) === gen) pendingChecks.delete(sessionId);
      if (!accepted) {
        release(true);
        pre.editedResend?.reject();
        if (
          !options?.queuedMessageId &&
          !options?.draftBlockId &&
          !pre.editedResend &&
          !options?.onSendRejected?.()
        ) {
          const recovery = {
            id: crypto.randomUUID(),
            text: input.text,
            attachments: input.attachments,
            noteCard: pre.noteCard,
            handoffCard: pre.handoffCard,
            intent: pre.intent,
            modelTarget: queuedModelTarget(options?.buildTarget ?? pre.storedCurrent),
          };
          setSessions((all) =>
            all.map((s) => (s.id === sessionId ? holdUndeliveredFollowUp(s, recovery) : s)),
          );
        }
      }
    }
  })();
}
