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
import { gateRunLease } from "./submitRunLease";
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
      // A send already being checked or leased must not start a second turn; say why.
      const holdSend = (text: string): false => {
        enqueueHarnessEvent(sessionId, { type: "status", text });
        flushHarnessEvents();
        return false;
      };
      if (isUsageBudgetChecking(sessionId, deps.refs.turnGen.current.get(sessionId)))
        return holdSend("The previous message is still being checked. Send again in a moment.");
      // The run lease is being asked for: this second send must not also start a turn.
      if (isRunLeasePending(sessionId))
        return holdSend("The previous message is still starting. Send again in a moment.");
      const routed = routeSubmitSession(deps, input);
      if (routed !== undefined) return routed;
      // An account picked during the last turn applies before this send.
      const accountApplied = applyPendingAccount(deps, input, () =>
        deps.getSubmitSessionRef().current(sessionId, text, attachments, options),
      );
      if (accountApplied !== undefined) return accountApplied;
      const preflight = prepareSubmitPreflight(deps, input);
      if (preflight.settled) return preflight.value;
      const { pre } = preflight;
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
      return gateRunLease(deps, input, pre, start, () =>
        Promise.allSettled([
          harnessRuntimeHints(sessionId),
          loadSkillRestrictions(pre.initialWorkCwd),
        ]),
      ) ?? start();
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
        enqueueHarnessEvent(args[0], {
          type: "status",
          text: "The workspace is switching. Send again in a moment.",
        });
        flushHarnessEvents();
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
    [submitSession, enqueueHarnessEvent, flushHarnessEvents],
  );

  return { submitSession, onSubmit };
}
