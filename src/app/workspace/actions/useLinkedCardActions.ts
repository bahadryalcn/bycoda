import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type LinkedWorkItemUpdateCard } from "../../../features/inbox/model/linkedWorkItemActivity";
import { markLinkedSessionUpdateSeen } from "../../../features/inbox/model/linkedSessionSeen";
import type { Session } from "../../../features/sessions/model/session";

export type SetLinkedWorkItemUpdateCard = (
  sessionId: string,
  update: (card: LinkedWorkItemUpdateCard | undefined) => LinkedWorkItemUpdateCard | undefined,
) => void;

export interface LinkedCardActionsDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
}

/** Linked work-item card updates on sessions; the single writer for `linkedWorkItemUpdateCard`. */
export function useLinkedCardActions(deps: LinkedCardActionsDeps): {
  setLinkedWorkItemUpdateCard: SetLinkedWorkItemUpdateCard;
  onLinkedWorkItemUpdateCardDismiss: (sessionId: string) => void;
} {
  const { sessionsRef, setSessions } = deps;

  const setLinkedWorkItemUpdateCard = useCallback(
    (
      sessionId: string,
      update: (card: LinkedWorkItemUpdateCard | undefined) => LinkedWorkItemUpdateCard | undefined,
    ) => {
      const previous = sessionsRef.current;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const card = update(session.linkedWorkItemUpdateCard);
        return card === session.linkedWorkItemUpdateCard
          ? session
          : { ...session, linkedWorkItemUpdateCard: card };
      });
      if (!next.some((session, index) => session !== previous[index])) return;
      sessionsRef.current = next;
      setSessions(next);
    },
    [],
  );

  const onLinkedWorkItemUpdateCardDismiss = useCallback(
    (sessionId: string) => {
      setLinkedWorkItemUpdateCard(sessionId, () => undefined);
    },
    [setLinkedWorkItemUpdateCard],
  );

  return { setLinkedWorkItemUpdateCard, onLinkedWorkItemUpdateCardDismiss };
}

export interface ContinuedSessionNoticeDeps {
  sessionsRef: MutableRefObject<Session[]>;
  sessionReminders: { dismissDue: (sessionId: string) => unknown };
  setLinkedWorkItemUpdateCard: SetLinkedWorkItemUpdateCard;
}

/** Clears reminder and linked-update notices once the user continues a session. */
export function useContinuedSessionNotices(deps: ContinuedSessionNoticeDeps): {
  dismissNoticesForContinuedSession: (sessionId: string) => void;
} {
  const { sessionsRef, sessionReminders, setLinkedWorkItemUpdateCard } = deps;

  const dismissNoticesForContinuedSession = useCallback(
    (sessionId: string) => {
      void sessionReminders.dismissDue(sessionId);
      const updatedAt = sessionsRef.current.find((session) => session.id === sessionId)
        ?.linkedWorkItemUpdateCard?.updatedAt;
      if (updatedAt == null) return;
      markLinkedSessionUpdateSeen(sessionId, updatedAt);
      setLinkedWorkItemUpdateCard(sessionId, (card) =>
        card?.updatedAt === updatedAt ? undefined : card,
      );
    },
    [sessionReminders.dismissDue, setLinkedWorkItemUpdateCard],
  );

  return { dismissNoticesForContinuedSession };
}
