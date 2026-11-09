import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../../../shared/i18n";
import {
  retainParentInput,
  type ParentAdmission,
  type ParentInputHandle,
} from "../data/parentInputClosure";
import { canRewindConversation } from "../model/conversationRewind";
import {
  planSessionFilesRevert,
  revertSessionFiles,
  type SessionFilesRevertPlan,
  type SessionFilesRevertResult,
} from "../model/editFromHere";
import type { LastTurnRecall } from "../model/editLastTurn";
import { isOperatorUserTurn, operatorUserPrompt } from "../model/operatorCommand";
import type { Block, Session } from "../model/session";
import type { EditFromHereMode } from "./EditFromHereDialog";

export type PendingRewind = {
  sessionId: string;
  block: Block;
  action: "edit" | "return";
  recall: LastTurnRecall;
  source: Session;
  authorityGeneration?: number;
  planAdmission: ParentAdmission;
};

type RewindDraftSignal = { sessionId: string; id: string; value: LastTurnRecall };

type Options = {
  session: Session;
  managed: boolean;
  sendBlockedReason?: string;
  lastUserMessage?: Block;
  onRewindMessage?: (sessionId: string, blockId: string) => Promise<boolean>;
  /** The pane's Parent input owner; read only from handlers. */
  rootParentRef: RefObject<ParentInputHandle | null>;
  /** Latest rendered session id/object, written by the pane. Read only after an await. */
  activeSessionIdRef: RefObject<string>;
  currentSessionRef: RefObject<Session>;
};

/** The transcript the dialog was opened on is unchanged. Session owners may rebuild the
 *  blocks array on every render (a remote pane filters unconfirmed drafts), so compare
 *  the block objects rather than the array identity. */
function sameTranscript(current: readonly Block[], opened: readonly Block[]): boolean {
  return (
    current === opened ||
    (current.length === opened.length && current.every((block, index) => block === opened[index]))
  );
}

/**
 * Edit-from-here / return-to-here controller of one session pane: the request,
 * the file-history plan preview, the confirmation and the unsent-draft hand-off
 * to the Composer. Everything is scoped to the session it was requested in and
 * is dropped, during render, when the pane shows another session.
 */
export function useMessageRewind({
  session,
  managed,
  sendBlockedReason,
  lastUserMessage,
  onRewindMessage,
  rootParentRef,
  activeSessionIdRef,
  currentSessionRef,
}: Options) {
  const t = useT();
  const sessionId = session.id;
  const [pendingRewind, setPendingRewind] = useState<PendingRewind | null>(null);
  const [rewindingMessage, setRewindingMessage] = useState(false);
  const [rewindError, setRewindError] = useState<string | null>(null);
  const [filePlan, setFilePlan] = useState<SessionFilesRevertPlan | null>(null);
  const [filePlanLoading, setFilePlanLoading] = useState(false);
  const [rewindMode, setRewindMode] = useState<EditFromHereMode | null>(null);
  const [fileRevertNotice, setFileRevertNotice] = useState<SessionFilesRevertResult | null>(null);
  const [rewindDraftSignal, setRewindDraftSignal] = useState<RewindDraftSignal | null>(null);
  /** Reverted files are remembered with their session so a retry never reverts twice. */
  const fileRevertResult = useRef<{
    sessionId: string;
    result: SessionFilesRevertResult;
  } | null>(null);
  const rewindInFlight = useRef(false);
  /** The running file-plan preview; cancelled by the next request, a close or unmount. */
  const planRun = useRef<{ cancelled: boolean } | null>(null);

  // Another session in the same pane drops every request, notice and signal.
  const [scopeSessionId, setScopeSessionId] = useState(sessionId);
  if (scopeSessionId !== sessionId) {
    setScopeSessionId(sessionId);
    setPendingRewind(null);
    setRewindError(null);
    setFilePlan(null);
    setFilePlanLoading(false);
    setRewindDraftSignal(null);
    setFileRevertNotice(null);
  }

  useEffect(
    () => () => {
      if (planRun.current) planRun.current.cancelled = true;
    },
    [],
  );

  const revertResultFor = (id: string) =>
    fileRevertResult.current?.sessionId === id ? fileRevertResult.current.result : null;

  const cancelFilePlan = () => {
    if (planRun.current) planRun.current.cancelled = true;
    planRun.current = null;
  };

  const startFilePlan = (request: PendingRewind) => {
    const run = { cancelled: false };
    planRun.current = run;
    const live = () => !run.cancelled && activeSessionIdRef.current === request.sessionId;
    const preparation = retainParentInput({
      kind: "session-parent",
      sessionId: request.sessionId,
      snapshot: () => ({
        source: "rewind-file-plan-preparation",
        blockId: request.block.id,
        action: request.action,
        recall: request.recall,
        authorityGeneration: request.authorityGeneration,
      }),
    });
    void request.planAdmission.run(() =>
      planSessionFilesRevert(request.source, request.block.id, {
        authorityGeneration: request.authorityGeneration,
      })
        .then((plan) => {
          if (live()) setFilePlan(plan);
        })
        .catch((error: unknown) => {
          if (!live()) return;
          const reason =
            error instanceof Error ? error.message : t("Session file history is unavailable.");
          setFilePlan({ files: [], unavailable: reason });
          setRewindError(reason);
        })
        .finally(() => {
          preparation.release();
          if (!run.cancelled) setFilePlanLoading(false);
        }),
    );
  };

  const requestMessageRewind = useCallback(
    (block: Block, action: "edit" | "return", recall?: LastTurnRecall) => {
      if (!canRewindConversation(session, block.id)) return;
      const admitted = rootParentRef.current?.admit();
      if (!admitted) return;
      cancelFilePlan();
      const request: PendingRewind = {
        sessionId: session.id,
        source: session,
        authorityGeneration: session.adoptedAuthorityGeneration,
        planAdmission: admitted,
        block,
        action,
        recall: recall ?? {
          text: isOperatorUserTurn(block) ? `/operator ${operatorUserPrompt(block)}` : block.text,
          attachments: block.attachments ?? [],
        },
      };
      setRewindError(null);
      fileRevertResult.current = null;
      setFilePlan(null);
      setFilePlanLoading(true);
      setPendingRewind(request);
      // The preview starts with the request, not after the dialog commits.
      startFilePlan(request);
    },
    [session],
  );

  const rewindLastTurnToDraft = useCallback(
    (recall: LastTurnRecall) => {
      if (lastUserMessage) requestMessageRewind(lastUserMessage, "edit", recall);
    },
    [lastUserMessage, requestMessageRewind],
  );

  const closeRewind = () => {
    cancelFilePlan();
    setPendingRewind(null);
  };

  /** The dialog's Cancel: refused while the rewind itself is being applied. */
  const cancelRewind = () => {
    if (!rewindInFlight.current) closeRewind();
  };

  const confirmMessageRewind = useCallback(
    async (mode: EditFromHereMode) => {
      if (!pendingRewind || rewindInFlight.current || !onRewindMessage) return;
      const requestedSessionId = pendingRewind.sessionId;
      if (requestedSessionId !== session.id) return;
      if (
        !canRewindConversation(session, pendingRewind.block.id) ||
        !sameTranscript(session.blocks, pendingRewind.source.blocks) ||
        session.adoptedAuthorityGeneration !== pendingRewind.authorityGeneration ||
        managed ||
        session.inboxAsk ||
        session.worktreeRemoved ||
        sendBlockedReason
      ) {
        setRewindError(t("This conversation can no longer be rewound."));
        return;
      }
      if (mode === "files" && (filePlanLoading || !filePlan || filePlan.unavailable)) return;
      const parent = rootParentRef.current;
      const admitted = parent?.admit();
      if (!parent || !admitted) return;
      return admitted.run(async () => {
        rewindInFlight.current = true;
        parent();
        setRewindingMessage(true);
        setRewindMode(mode);
        setRewindError(null);
        const preparation = retainParentInput({
          kind: "session-parent",
          sessionId: requestedSessionId,
          snapshot: () => ({
            source: "rewind-preparation",
            blockId: pendingRewind.block.id,
            action: pendingRewind.action,
            recall: pendingRewind.recall,
            authorityGeneration: pendingRewind.authorityGeneration,
            mode,
            filePlan,
          }),
        });
        try {
          if (mode === "files" && !revertResultFor(requestedSessionId)) {
            const result = await revertSessionFiles(
              pendingRewind.source,
              pendingRewind.block.id,
              filePlan?.planToken,
              filePlan ?? undefined,
            );
            if (activeSessionIdRef.current !== requestedSessionId) return;
            fileRevertResult.current = { sessionId: requestedSessionId, result };
            setFileRevertNotice(result);
          }
          if (
            !sameTranscript(currentSessionRef.current.blocks, pendingRewind.source.blocks) ||
            currentSessionRef.current.adoptedAuthorityGeneration !==
              pendingRewind.authorityGeneration ||
            !canRewindConversation(currentSessionRef.current, pendingRewind.block.id)
          ) {
            throw new Error(t("This conversation can no longer be rewound."));
          }
          const accepted = await admitted.apply(() =>
            onRewindMessage(requestedSessionId, pendingRewind.block.id),
          );
          if (activeSessionIdRef.current !== requestedSessionId) return;
          if (!accepted) {
            setRewindError(
              t(
                revertResultFor(requestedSessionId)
                  ? "Files were reverted, but the conversation could not be rewound. Retry to finish editing this message."
                  : "The conversation could not be rewound. Try again.",
              ),
            );
            return;
          }
          setRewindDraftSignal({
            sessionId: requestedSessionId,
            id: crypto.randomUUID(),
            value: pendingRewind.recall,
          });
          closeRewind();
        } catch (error: unknown) {
          if (activeSessionIdRef.current !== requestedSessionId) return;
          setRewindError(
            revertResultFor(requestedSessionId)
              ? t(
                  "Files were reverted, but the conversation could not be rewound. Retry to finish editing this message.",
                )
              : error instanceof Error
                ? error.message
                : t("The conversation could not be rewound. Try again."),
          );
        } finally {
          preparation.release();
          rewindInFlight.current = false;
          parent();
          setRewindingMessage(false);
          setRewindMode(null);
        }
      });
    },
    [
      filePlan,
      filePlanLoading,
      managed,
      onRewindMessage,
      pendingRewind,
      sendBlockedReason,
      session,
    ],
  );

  /** The Composer applied the recalled draft: the signal has done its job. */
  const acknowledgeDraftSignal = useCallback((id: string) => {
    setRewindDraftSignal((current) => (current?.id === id ? null : current));
  }, []);

  /** Parent-input checkpoint view of the controller; read lazily, never during render. */
  const snapshot = () => ({
    rewindDraftSignal,
    pendingRewind: pendingRewind
      ? {
          sessionId: pendingRewind.sessionId,
          blockId: pendingRewind.block.id,
          action: pendingRewind.action,
          recall: pendingRewind.recall,
          authorityGeneration: pendingRewind.authorityGeneration,
        }
      : null,
    rewindingMessage,
    rewindInFlight: rewindInFlight.current,
    rewindError,
    rewindMode,
    filePlan,
    filePlanLoading,
    fileRevertNotice,
    fileRevertResult: revertResultFor(sessionId),
  });

  return {
    pendingRewind,
    rewindingMessage,
    rewindError,
    filePlan,
    filePlanLoading,
    rewindMode,
    fileRevertNotice,
    rewindDraftSignal,
    requestMessageRewind,
    rewindLastTurnToDraft,
    confirmMessageRewind,
    cancelRewind,
    acknowledgeDraftSignal,
    snapshot,
  };
}
