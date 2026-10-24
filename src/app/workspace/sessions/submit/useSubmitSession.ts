import { useCallback } from "react";
import { isRunLeasePending } from "../../../../features/connections/model/runLeaseClient";
import type { Attachment } from "../../../../features/sessions/model/session";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import type { Submit, SubmitOptions } from "../../helpers/types";
import { gateProjectLocation } from "./submitProjectLocation";
import { prepareSubmitPreflight } from "./submitPreflight";
import { routeSubmitSession } from "./submitRouting";
import { steerBusySubmit } from "./submitBusySteer";
import { gateRunLease } from "./submitRunLease";
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
      if (isUsageBudgetChecking(sessionId, deps.refs.turnGen.current.get(sessionId))) return false;
      // The run lease is being asked for: this second send must not also start a turn.
      if (isRunLeasePending(sessionId)) return false;
      const routed = routeSubmitSession(deps, input);
      if (routed !== undefined) return routed;
      const preflight = prepareSubmitPreflight(deps, input);
      if (preflight.settled) return preflight.value;
      const { pre } = preflight;
      const busy = steerBusySubmit(deps, input, pre);
      if (busy !== undefined) return busy;
      const located = gateProjectLocation(deps, input, pre);
      if (located !== undefined) return located;
      const dispatch = () => {
        const setup = prepareSubmittedTurn(deps, input, pre);
        if (setup.settled) return setup.value;
        startSubmittedTurn(deps, input, pre, setup.setup);
        return true;
      };
      const start = () => gateUsageBudget(deps, input, pre, dispatch) ?? dispatch();
      return gateRunLease(deps, input, pre, start) ?? start();
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
      if (workspaceNavigation.isSwitching(args[0])) return false;
      const result = submitSession(...args);
      if (typeof result === "boolean") return result;
      // Deferred errors have already been displayed by submitAfterProjectSync.
      void result.catch((error) => {
        console.warn("App operation failed", error);
      });
      return true;
    },
    [submitSession],
  );

  return { submitSession, onSubmit };
}
