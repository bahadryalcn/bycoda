import type { SubmitDeps, SubmitInput, SubmitPreflight, SubmitSetup } from "./submitTypes";

import { orchestrator } from "../../../../features/orchestration/model/orchestration";
import { conversationReplayPrompt } from "../../../../features/sessions/model/conversationRewind";
import { completeHandoff, isPreparingHandoff } from "../../../../features/sessions/model/handoff";
import { planTurnKey } from "../../../../features/sessions/model/plan";
import { type Session } from "../../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import { type HarnessEvent } from "../../../../integrations/harness";
import { recordPerformanceEvent } from "../../../../shared/lib/performanceTrace";
import { nudgeOpenEditors, trackSessionEdits } from "../../helpers/workspaceNotify";
import { flushSync } from "react-dom";

export function createSubmitTurnEvents(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  setup: SubmitSetup,
  workCwd: string,
) {
  const { enqueueHarnessEvent, deferWorkspaceWork } = ctx;
  const { retiringTurns, turnGen } = ctx.refs;
  const { sessionId, options } = input;
  const { current, editedResend, intent } = pre;
  const { traceId, gen, commitSubmittedTurn, turn } = setup;
  const revealHandoff = (brief: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
        return { ...completeHandoff(s, brief), busy: true };
      }),
    );
  };

  const planEventKey = planTurnKey(gen);
  turn.nativePlanSeen = false;
  turn.providerFailureSeen = false;
  const routePlanEvent = (event: HarnessEvent): HarnessEvent | null => {
    if (event.type === "session.error") {
      turn.providerFailureSeen = true;
      retiringTurns.current.set(sessionId, gen);
    }
    if (turn.proposalDraft) {
      if (event.type === "message.delta") {
        turn.proposalText = (turn.proposalText + event.text).slice(-200_000);
        return null;
      }
      if (event.type === "message.completed") {
        turn.proposalText += "\n";
        return null;
      }
      if (event.type === "plan") {
        turn.nativeProposalText = event.append ? turn.nativeProposalText + event.text : event.text;
        return null;
      }
    }
    if (intent !== "plan") return event;
    if (event.type === "plan") {
      turn.nativePlanSeen = true;
      return {
        ...event,
        key: planEventKey,
      };
    }
    return event;
  };

  const pendingEditedEvents: HarnessEvent[] = [];
  const applyTurnEvent = (event: HarnessEvent) => {
    orchestrator.observe(sessionId, event);
    if (options?.onSettled && event.type === "message.delta")
      turn.controlText = (turn.controlText + event.text).slice(-20_000);
    if (options?.onSettled && event.type === "message.completed") turn.controlText += "\n";
    if (event.type === "session.error") turn.controlOutcome.error = event.message;
    if (
      turn.wrap &&
      (event.type === "session.started" || event.type === "session.providerBound")
    ) {
      revealHandoff(turn.wrap.text);
    }
    nudgeOpenEditors(event, workCwd, deferWorkspaceWork);
    if (!orchestrator.forSession(sessionId)) trackSessionEdits(sessionId, workCwd, event);
    const routed = routePlanEvent(event);
    if (routed) enqueueHarnessEvent(sessionId, routed);
  };
  turn.sawProviderEvent = false;
  const contextReplay = conversationReplayPrompt(current);
  turn.contextReplayAccepted = !contextReplay;
  const acceptContextReplay = () => {
    if (turn.contextReplayAccepted || turnGen.current.get(sessionId) !== gen) return;
    turn.contextReplayAccepted = true;
    const consume = (session: Session) => session.id === sessionId &&
      session.pendingContextReplay === contextReplay
        ? { ...session, pendingContextReplay: undefined }
        : session;
    sessionsRef.current = sessionsRef.current.map(consume);
    setSessions((prev) => prev.map(consume));
  };
  const routeTurnEvent = (event: HarnessEvent) => {
    if (event.type === "turn.started" || event.type === "message.delta" ||
        event.type === "reasoning.delta" || event.type === "tool.started") {
      acceptContextReplay();
    }
    if (!turn.sawProviderEvent) {
      turn.sawProviderEvent = true;
      recordPerformanceEvent("provider-first-event", {}, traceId);
    }
    recordPerformanceEvent("renderer-receive", {}, traceId);
    if (turnGen.current.get(sessionId) !== gen) return;
    if (editedResend && !editedResend.isAccepted()) {
      pendingEditedEvents.push(event);
      return;
    }
    applyTurnEvent(event);
  };
  const acceptEditedResend = () => {
    if (!editedResend || editedResend.isAccepted()) return;
    flushSync(commitSubmittedTurn);
    editedResend.markAccepted();
    for (const event of pendingEditedEvents) applyTurnEvent(event);
    pendingEditedEvents.length = 0;
  };
  const recoverEditedResend = () => {
    if (!editedResend || editedResend.isAccepted()) return;
    pendingEditedEvents.length = 0;
    const previous = sessionsRef.current.find((session) => session.id === sessionId);
    const recovered = previous ? editedResend.recoverAfterFailure(previous) : undefined;
    flushSync(() => {
      setSessions((prev) =>
        prev.map((session) => (session.id === sessionId && recovered ? recovered : session)),
      );
    });
  };
  return { revealHandoff, routeTurnEvent, acceptContextReplay, acceptEditedResend, recoverEditedResend, contextReplay, planEventKey };
}


export type SubmitTurnEvents = ReturnType<typeof createSubmitTurnEvents>;
