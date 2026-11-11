import { useCallback, type Dispatch, type SetStateAction } from "react";
import { type Session } from "../../../features/sessions/model/session";

export interface TurnCardActionDeps {
  setSessions: Dispatch<SetStateAction<Session[]>>;
}

export interface TurnCardActions {
  onInboxCardDismiss: (sessionId: string) => void;
  onNoteCardDismiss: (sessionId: string) => void;
  onHandoffCardDismiss: (sessionId: string) => void;
}

/** Dismiss handlers for the card that a session carries on its first turn. */
export function useTurnCardActions(deps: TurnCardActionDeps): TurnCardActions {
  const { setSessions } = deps;

  const onInboxCardDismiss = useCallback(
    (sessionId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && session.inboxCard
            ? { ...session, inboxCard: undefined }
            : session,
        ),
      );
    },
    [setSessions],
  );

  const onNoteCardDismiss = useCallback(
    (sessionId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && session.noteCard
            ? { ...session, noteCard: undefined }
            : session,
        ),
      );
    },
    [setSessions],
  );

  const onHandoffCardDismiss = useCallback(
    (sessionId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && session.handoffCard
            ? { ...session, handoffCard: undefined }
            : session,
        ),
      );
    },
    [setSessions],
  );

  return { onInboxCardDismiss, onNoteCardDismiss, onHandoffCardDismiss };
}
