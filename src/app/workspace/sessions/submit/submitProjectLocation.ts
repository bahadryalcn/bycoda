import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

import { synchronizeProjectLocation } from "../../../../features/projects/model/projectLocation";
import { looksLikeProject } from "../../../../features/projects/model/recents";
import { holdUndeliveredFollowUp, queuedModelTarget } from "../../../../features/sessions/model/messageQueue";
import { type QueuedMessage } from "../../../../features/sessions/model/session";
import { setSessions } from "../../../../features/sessions/model/sessionsStore";
import { pathKey } from "../../../../shared/lib/paths";
import { submitAfterProjectSync, type SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { flushSync } from "react-dom";

export function gateProjectLocation(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
): SubmissionAcceptance | undefined {
  const { applyProjectLocationChange, enqueueHarnessEvent, flushHarnessEvents } = ctx;
  const { turnGen, projectLocationSyncs, submitAfterProjectSyncRef } = ctx.refs;
  const { sessionId, text, attachments, options } = input;
  const { storedCurrent, current, editedResend, intent, noteCard, handoffCard } = pre;
  if (!options?.projectLocationReady && looksLikeProject(current.cwd) && !current.worktreeCwd) {
    const preparationGen = (turnGen.current.get(sessionId) ?? 0) + 1;
    turnGen.current.set(sessionId, preparationGen);
    const preparationIsCurrent = () => turnGen.current.get(sessionId) === preparationGen;
    flushSync(() =>
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, busy: true, worktreePreparing: true }
            : session,
        ),
      ),
    );
    const releasePreparation = () => {
      if (!preparationIsCurrent()) return;
      flushSync(() =>
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId && preparationIsCurrent()
              ? { ...session, busy: false, worktreePreparing: undefined }
              : session,
          ),
        ),
      );
    };
    const key = pathKey(current.cwd);
    let sync = projectLocationSyncs.current.get(key);
    if (!sync) {
      sync = synchronizeProjectLocation(current.cwd);
      projectLocationSyncs.current.set(key, sync);
      void sync.then(
        () => projectLocationSyncs.current.delete(key),
        () => projectLocationSyncs.current.delete(key),
      );
    }
    return submitAfterProjectSync({
      cwd: current.cwd,
      sync,
      isCurrent: preparationIsCurrent,
      applyLocationChange: applyProjectLocationChange,
      submit: async () => {
        releasePreparation();
        const accepted = await submitAfterProjectSyncRef.current(sessionId, text, attachments, {
          ...options,
          projectLocationReady: true,
        });
        if (!accepted) {
          editedResend?.reject();
          options?.onSettled?.({
            status: "failed",
            text: "",
            error:
              "The chat became unavailable before the request could start. Try again when it is ready.",
          });
        }
        return accepted;
      },
      onRejected: () => {
        releasePreparation();
        // Existing draft/queue rows were not removed before preparation.
        if (options?.queuedMessageId || options?.draftBlockId || editedResend) return;
        if (options?.onSendRejected?.()) return;
        const recovery: QueuedMessage = {
          id: crypto.randomUUID(),
          text,
          attachments,
          noteCard,
          handoffCard,
          intent,
          modelTarget: queuedModelTarget(options?.buildTarget ?? storedCurrent),
        };
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId ? holdUndeliveredFollowUp(session, recovery) : session,
          ),
        );
      },
      onError: (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "The project folder could not be opened.";
        enqueueHarnessEvent(sessionId, {
          type: "session.error",
          message,
        });
        flushHarnessEvents();
        editedResend?.reject();
        options?.onSettled?.({
          status: "failed",
          text: "",
          error: message,
        });
      },
    });
  }
}

