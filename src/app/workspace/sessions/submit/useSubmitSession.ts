import { useCallback } from "react";
import { endActiveSubmit } from "../../../../features/sessions/model/activeSubmits";
import { isRunLeasePending } from "../../../../features/connections/model/runLeaseClient";
import type { Attachment } from "../../../../features/sessions/model/session";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import type { Submit, SubmitOptions } from "../../helpers/types";
import { gateProjectLocation } from "./submitProjectLocation";
import { applyPendingAccount } from "./submitPendingAccount";
import { prepareSubmitPreflight } from "./submitPreflight";
import { routeSubmitSession } from "./submitRouting";
import { steerBusySubmit } from "./submitBusySteer";
import { gateRunLease, isRunLeaseStarting } from "./submitRunLease";
import { queueWhileStarting } from "./submitStarting";
import { showSubmitNotice } from "./submitNotice";
import { isPreparingHandoff } from "../../../../features/sessions/model/handoff";
import { harnessRuntimeHints } from "../../../../integrations/harness/core/runtimeGuidance";
import { loadSkillRestrictions } from "../../../../features/skills/model/skillPreferences";
import { startSubmittedTurn } from "./submitTurnRun";
import { prepareSubmittedTurn } from "./submitTurnSetup";
import type { SubmitDeps, SubmitInput } from "./submitTypes";
import { gateUsageBudget, isUsageBudgetChecking } from "./submitUsageBudget";

/**
 * `submitSession` and `onSubmit` for the workspace composer. The body of the
 * submit is split into sequential phases; each phase returns either `undefined`
 * (continue), a settled acceptance (return it), or the values the next phase needs.
 * The `submitSessionRef` / `submitAfterProjectSyncRef` mirrors stay in `Workspace`.
 */
export function useSubmitSession(deps: SubmitDeps) {
  const {
    workspaceNavigation,
    applyProjectLocationChange,
    dismissNoticesForContinuedSession,
    enqueueHarnessEvent,
    flushHarnessEvents,
    runSessionShell,
  } = deps;

  const submitSession = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: SubmitOptions,
    ): SubmissionAcceptance => {
      const input: SubmitInput = { sessionId, text, attachments, options };
      const routed = routeSubmitSession(deps, input);
      if (routed !== undefined) return routed;
      // A send still being checked, waiting for the run lease or preparing must
      // not also start a turn: this one is queued to go out right after it.
      const generation = deps.refs.turnGen.current.get(sessionId);
      const startingReason = isUsageBudgetChecking(sessionId, generation)
        ? "The previous message is still being checked. Send again in a moment."
        : isRunLeaseStarting(sessionId, generation) || isRunLeasePending(sessionId)
          ? "The previous message is still starting. Send again in a moment."
          : undefined;
      if (startingReason) {
        const early = prepareSubmitPreflight(deps, input);
        if (early.settled) return early.value;
        return queueWhileStarting(deps, input, early.pre, startingReason);
      }
      // An account picked during the last turn applies before this send.
      const accountApplied = applyPendingAccount(deps, input, () =>
        deps.getSubmitSessionRef().current(sessionId, text, attachments, options),
      );
      if (accountApplied !== undefined) return accountApplied;
      const preflight = prepareSubmitPreflight(deps, input);
      if (preflight.settled) return preflight.value;
      const { pre } = preflight;
      // A provider handoff in progress (up to a minute) is not a reason to
      // refuse: the message is queued and goes out when it has finished.
      if (isPreparingHandoff(pre.current))
        return queueWhileStarting(
          deps,
          input,
          pre,
          "Message not sent: wait for the provider handoff to finish.",
        );
      const busy = steerBusySubmit(deps, input, pre);
      if (busy !== undefined) return busy;
      const located = gateProjectLocation(deps, input, pre);
      if (located !== undefined) return located;
      const dispatch = () => {
        try {
          const setup = prepareSubmittedTurn(deps, input, pre);
          if (setup.settled) return setup.value;
          startSubmittedTurn(deps, input, pre, setup.setup);
          return true;
        } catch (error) {
          // Preparation failed before the turn owned its generation.
          const gen = deps.refs.turnGen.current.get(sessionId);
          if (gen !== undefined) endActiveSubmit(sessionId, gen);
          throw error;
        }
      };
      const start = () => gateUsageBudget(deps, input, pre, dispatch) ?? dispatch();
      return (
        gateRunLease(deps, input, pre, start, () =>
          Promise.allSettled([
            harnessRuntimeHints(sessionId),
            loadSkillRestrictions(pre.initialWorkCwd),
          ]),
        ) ?? start()
      );
    },
    [
      applyProjectLocationChange,
      dismissNoticesForContinuedSession,
      enqueueHarnessEvent,
      flushHarnessEvents,
      runSessionShell,
    ],
  );

  // Interactive callers use the immediate result to clear their composer. The
  // queued-launch receiver uses submitSession to await the actual acceptance.
  const onSubmit = useCallback(
    (...args: Parameters<Submit>): boolean => {
      // Reject before async preparation can make the composer clear its draft.
      if (workspaceNavigation.isSwitching(args[0])) {
        showSubmitNotice(args[0], "The workspace is switching. Send again in a moment.");
        return false;
      }
      const result = submitSession(...args);
      if (typeof result === "boolean") return result;
      // Deferred errors have already been displayed by submitAfterProjectSync.
      void result.catch((error) => {
        console.warn("App operation failed", error);
      });
      return true;
    },
    [submitSession, workspaceNavigation],
  );

  return { submitSession, onSubmit };
}
