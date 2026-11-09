import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

import { synchronizeProjectLocation } from "../../../../features/projects/model/projectLocation";
import { looksLikeProject } from "../../../../features/projects/model/recents";
import {
  holdUndeliveredFollowUp,
  queuedModelTarget,
} from "../../../../features/sessions/model/messageQueue";
import { type QueuedMessage } from "../../../../features/sessions/model/session";
import { setSessions } from "../../../../features/sessions/model/sessionsStore";
import { pathKey } from "../../../../shared/lib/paths";
import {
  submitAfterProjectSync,
  type SubmissionAcceptance,
} from "../../../model/submissionAcceptance";
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
          session.id === sessionId ? { ...session, busy: true, worktreePreparing: true } : session,
        ),
      ),
    );
    // Not committed synchronously: the send that follows marks the conversation
    // busy again in the same tick, and an idle frame in between flashes the composer.
    const releasePreparation = () => {
      if (!preparationIsCurrent()) return;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && preparationIsCurrent()
            ? { ...session, busy: false, worktreePreparing: undefined }
            : session,
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
    // Nested send gates and project preparation can both reject the same send.
    // Share one recovery owner so a restored draft or held row is never copied.
    let recovered = false;
    const recoverUnstarted = (): boolean => {
      if (recovered) return true;
      recovered = true;
      releasePreparation();
      // Existing draft/queue rows were not removed before preparation.
      if (options?.queuedMessageId || options?.draftBlockId || editedResend) return true;
      if (options?.onSendRejected?.()) return true;
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
      return true;
    };
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
          onSendRejected: recoverUnstarted,
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
      onRejected: recoverUnstarted,
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
