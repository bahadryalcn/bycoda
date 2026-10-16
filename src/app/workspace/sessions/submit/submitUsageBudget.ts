import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import {
  assertUsageBudgets,
  blockingUsageBudgets,
} from "../../../../features/usage/model/usageBudgetReadings";
import {
  holdUndeliveredFollowUp,
  queuedModelTarget,
} from "../../../../features/sessions/model/messageQueue";
import { getSessions, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { t } from "../../../../shared/i18n";

const pendingChecks = new Map<string, number>();
export function isUsageBudgetChecking(sessionId: string, generation: number | undefined): boolean {
  return generation != null && pendingChecks.get(sessionId) === generation;
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
    ctx.enqueueHarnessEvent(input.sessionId, { type: "session.error", message: String(error) });
    ctx.flushHarnessEvents();
    input.options?.onSettled?.({ status: "failed", text: "", error: String(error) });
    return false;
  }
  const { sessionId, options } = input;
  const { turnGen } = ctx.refs;
  const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
  turnGen.current.set(sessionId, gen);
  pendingChecks.set(sessionId, gen);
  const isCurrent = () => turnGen.current.get(sessionId) === gen;
  setSessions((all) => all.map((s) => (s.id === sessionId ? { ...s, busy: true } : s)));
  let accepted = false;
  const release = () => {
    if (isCurrent())
      setSessions((all) => all.map((s) => (s.id === sessionId ? { ...s, busy: false } : s)));
  };
  return (async () => {
    try {
      await assertUsageBudgets(pre.current);
      if (!isCurrent()) return false;
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
        release();
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
