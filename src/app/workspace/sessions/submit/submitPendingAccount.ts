import type { SubmitDeps, SubmitInput } from "./submitTypes";

import {
  providerAccountLabel,
  supportsProviderAccounts,
} from "../../../../features/providers/model/providerAccounts";
import { switchSessionAccount } from "../../../../features/sessions/model/accountSwitch";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { bindHarnessSession, forgetHarnessSession } from "../../../../integrations/harness";
import { transferProviderSession } from "../../../../platform/tauri/providerSessionTransfer";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";

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
  if (applying.has(sessionId)) return false;
  const provider = session.harness;
  const say = (text: string) => {
    ctx.enqueueHarnessEvent(sessionId, { type: "status", text });
    ctx.flushHarnessEvents();
  };
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
    }
    const accepted = await resume();
    if (!accepted) say("Message not sent after the account switch. Send it again.");
    return accepted;
  })();
}
