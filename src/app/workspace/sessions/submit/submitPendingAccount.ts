import type { SubmitDeps, SubmitInput } from "./submitTypes";

import {
  providerAccountLabel,
  supportsProviderAccounts,
} from "../../../../features/providers/model/providerAccounts";
import { switchSessionAccount } from "../../../../features/sessions/model/accountSwitch";
import {
  holdUndeliveredFollowUp,
  queuedModelTarget,
} from "../../../../features/sessions/model/messageQueue";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { bindHarnessSession, forgetHarnessSession } from "../../../../integrations/harness";
import { transferProviderSession } from "../../../../platform/tauri/providerSessionTransfer";
import { t } from "../../../../shared/i18n";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { showSubmitNotice } from "./submitNotice";
import { prepareSubmitPreflight } from "./submitPreflight";
import { queueWhileStarting } from "./submitStarting";
import {
  beginDeliveryProgress,
  clearDeliveryProgress,
} from "../../../../features/sessions/model/deliveryProgress";

const applying = new Set<string>();

/**
 * An account picked while a turn ran waits for the next idle send. Returns
 * undefined when nothing is pending; otherwise the send resumes through
 * `resume` once the account has been switched (or the switch gave up).
 */
export function applyPendingAccount(
  ctx: SubmitDeps,
  input: SubmitInput,
  resume: () => SubmissionAcceptance,
): SubmissionAcceptance | undefined {
  const { sessionId } = input;
  const session = sessionsRef.current.find((entry) => entry.id === sessionId);
  const accountId = session?.nextProviderAccountId;
  if (!session || !accountId) return undefined;
  if (session.busy || session.continuingElsewhere) return undefined;
  if (applying.has(sessionId)) {
    // The switch is still running: this message goes out right after it.
    const early = prepareSubmitPreflight(ctx, input);
    if (early.settled) return early.value;
    return queueWhileStarting(
      ctx,
      input,
      early.pre,
      t("The account is still being switched. Send again in a moment."),
    );
  }
  const provider = session.harness;
  const say = (text: string) => showSubmitNotice(sessionId, text);
  const clear = () =>
    setSessions((prev) =>
      prev.map((entry) =>
        entry.id === sessionId && entry.nextProviderAccountId === accountId
          ? { ...entry, nextProviderAccountId: undefined }
          : entry,
      ),
    );
  if (!supportsProviderAccounts(provider)) {
    clear();
    return undefined;
  }
  applying.add(sessionId);
  // The composer has already cleared. The switch needs an idle conversation (no
  // busy mark, no new transcript row), so the wait shows as delivery progress
  // beside the composer, and a second message is queued by the `applying` check.
  const progress = beginDeliveryProgress(sessionId, crypto.randomUUID(), "preparing");
  // The message the composer already gave up goes back to it, or into the
  // paused queue when the composer holds something newer.
  const keepUnsent = () => {
    const { options } = input;
    if (options?.queuedMessageId || options?.draftBlockId) return;
    if (options?.onSendRejected?.()) return;
    const latest = sessionsRef.current.find((entry) => entry.id === sessionId) ?? session;
    const recovery = {
      id: crypto.randomUUID(),
      text: input.text,
      attachments: input.attachments,
      noteCard: options && "noteCard" in options ? options.noteCard : latest.noteCard,
      handoffCard: options && "handoffCard" in options ? options.handoffCard : latest.handoffCard,
      intent: options?.intent ?? ("default" as const),
      modelTarget: queuedModelTarget(options?.buildTarget ?? latest),
    };
    setSessions((prev) =>
      prev.map((entry) => (entry.id === sessionId ? holdUndeliveredFollowUp(entry, recovery) : entry)),
    );
  };
  return (async () => {
    try {
      const result = await switchSessionAccount(sessionId, provider, accountId, {
        transfer: transferProviderSession,
        forget: forgetHarnessSession,
        bind: bindHarnessSession,
        latest: (id) => sessionsRef.current.find((entry) => entry.id === id),
        label: providerAccountLabel,
        removing: (id) => ctx.refs.removingSessionIds.current.has(id),
      });
      if (result.kind === "switched") {
        setSessions((prev) =>
          prev.map((entry) => (entry.id === sessionId ? result.update(entry) : entry)),
        );
        if (result.status) say(result.status);
      } else if (result.kind !== "noop") {
        say(
          `Could not switch to ${providerAccountLabel(provider, accountId)}; sending with the current account.`,
        );
      }
    } catch (error) {
      console.warn("App operation failed", error);
      say(
        `Could not switch to ${providerAccountLabel(provider, accountId)}; sending with the current account.`,
      );
    } finally {
      // Always cleared, so the resumed send cannot come back here.
      clear();
      applying.delete(sessionId);
      clearDeliveryProgress(sessionId, progress);
    }
    let result: SubmissionAcceptance;
    try {
      result = resume();
    } catch (error) {
      console.warn("App operation failed", error);
      result = false;
    }
    // A refusal that came back at once held nothing: the message is kept here.
    // A deferred send recovers its own message when it does not start.
    if (result === false) {
      keepUnsent();
      say(t("Message not sent after the account switch. Your message is kept."));
      return false;
    }
    const accepted = await result;
    if (!accepted) say(t("Message not sent after the account switch."));
    return accepted;
  })();
}
