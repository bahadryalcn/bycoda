import {
  clearConversation,
  clearConversationBlocker,
} from "../../../../features/sessions/model/clearConversation";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { upsertClearedSession } from "../../../../features/sessions/data/sessionStore";
import { forgetHarnessSession } from "../../../../integrations/harness";
import { t } from "../../../../shared/i18n";
import { showSubmitNotice } from "./submitNotice";
import type { SubmitDeps } from "./submitTypes";

export function submitClearConversation(ctx: SubmitDeps, sessionId: string): boolean {
  ctx.flushHarnessEvents();
  const snapshot = sessionsRef.current.find((session) => session.id === sessionId);
  if (!snapshot) return false;
  // Say why: a bare refusal leaves the text in the composer with no explanation.
  const blocker = clearConversationBlocker(snapshot);
  if (blocker) {
    showSubmitNotice(sessionId, blocker);
    return false;
  }
  const editToken = ctx.refs.editedResends.start(sessionId);
  if (!editToken) {
    showSubmitNotice(
      sessionId,
      t("Another change to this conversation is in progress. Try clearing again in a moment."),
    );
    return false;
  }
  // Hold submission until both the provider binding and durable transcript are cleared.
  ctx.refs.retiringTurns.current.set(sessionId, ctx.refs.turnGen.current.get(sessionId) ?? 0);
  void (async () => {
    try {
      await forgetHarnessSession(snapshot.harness, sessionId);
      if (snapshot.pendingSwitch && snapshot.pendingSwitch.from !== snapshot.harness)
        await forgetHarnessSession(snapshot.pendingSwitch.from, sessionId);
      const latest = sessionsRef.current.find((session) => session.id === sessionId);
      if (!latest || latest.blocks !== snapshot.blocks || latest.busy)
        throw new Error("The conversation changed while clearing. Try again.");
      const cleared = clearConversation(latest);
      if (!cleared.inboxAsk && cleared.cwd !== "~" && !(await upsertClearedSession(cleared)))
        throw new Error("The conversation changed before it could be saved. Try again.");
      ctx.refs.turnGen.current.set(sessionId, (ctx.refs.turnGen.current.get(sessionId) ?? 0) + 1);
      setSessions((sessions) =>
        sessions.map((session) =>
          session.id === sessionId ? clearConversation(session) : session,
        ),
      );
    } catch (error) {
      ctx.enqueueHarnessEvent(sessionId, {
        type: "session.error",
        message: error instanceof Error ? error.message : "Could not clear the conversation",
      });
      ctx.flushHarnessEvents();
    } finally {
      ctx.refs.retiringTurns.current.delete(sessionId);
      ctx.refs.editedResends.finish(sessionId, editToken);
    }
  })();
  return true;
}
