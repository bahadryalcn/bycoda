import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  HARNESS_LABEL,
  canReplaceSessionTitle,
  removeSessionDraft,
  sessionDraftBlock,
  titleFromPrompt,
  type Attachment,
  type Session,
} from "../../../features/sessions/model/session";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import {
  discardDraftSessionRecord,
  shouldPersistSession,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";

export interface SessionDraftActionDeps {
  pendingPersist: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  lastPersistedUserBlock: MutableRefObject<Map<string, string>>;
  invalidateLoadedSession: (sessionId: string) => void;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
}

/** Shared draft construction for interactive and explicitly owned Room creation. */
export function addSessionDraft(session: Session, text: string, attachments: Attachment[] = [], appRequestId?: string): Session {
  if (sessionDraftBlock(session)) return session;
  const title = canReplaceSessionTitle(session.title, session.harness, HARNESS_LABEL[session.harness])
    ? titleFromPrompt(text, session.harness, attachments) : session.title;
  return { ...session, title, blocks: [...session.blocks, { id: crypto.randomUUID(), role: "user", text, ...(attachments.length ? { attachments } : {}), draft: true, ...(appRequestId ? { appRequestId } : {}) }] };
}

export function useSessionDraftActions({
  pendingPersist,
  lastPersisted,
  lastPersistedUserBlock,
  invalidateLoadedSession,
  setHistory,
  setStoredLinkedSessions,
}: SessionDraftActionDeps) {
  const onSaveDraft = useCallback(
    (sessionId: string, text: string, attachments: Attachment[] = [], appRequestId?: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (current && (hostSessionBinding(current) || remoteProjectFor(current.cwd)))
        return !!remoteSessionActions(sessionId)?.saveDraft(text, attachments);
      if (
        !current ||
        current.busy ||
        sessionDraftBlock(current) ||
        current.inboxAsk ||
        current.worktreeRemoved ||
        (!text.trim() && attachments.length === 0)
      ) {
        return false;
      }
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && !sessionDraftBlock(session)
            ? addSessionDraft(session, text, attachments, appRequestId)
            : session,
        ),
      );
      return true;
    },
    [],
  );

  const onRemoveDraft = useCallback(
    (sessionId: string, draftBlockId: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (!current) return false;
      if (hostSessionBinding(current))
        return remoteSessionActions(sessionId)?.removeDraft?.(draftBlockId) ?? false;
      const withoutDraft = removeSessionDraft(current, draftBlockId);
      if (!withoutDraft) return false;

      if (!shouldPersistSession(withoutDraft)) {
        pendingPersist.current.delete(sessionId);
        lastPersisted.current.delete(sessionId);
        lastPersistedUserBlock.current.delete(sessionId);
        invalidateLoadedSession(sessionId);
        setHistory((history) => history.filter((session) => session.id !== sessionId));
        setStoredLinkedSessions((history) => history.filter((session) => session.id !== sessionId));
        void discardDraftSessionRecord(sessionId).catch((error) => {
          console.warn("App operation failed", error);
        });
      }

      setSessions((sessions) =>
        sessions.map((session) =>
          session.id === sessionId
            ? (removeSessionDraft(session, draftBlockId) ?? session)
            : session,
        ),
      );
      return true;
    },
    [invalidateLoadedSession],
  );

  return { onSaveDraft, onRemoveDraft };
}
