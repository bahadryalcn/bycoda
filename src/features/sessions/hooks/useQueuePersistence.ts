import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import { setSessionQueue } from "../data/sessionStore";
import { createQueuePersistenceSync } from "../model/queuePersistenceSync";
import { getShellSessions, subscribeShell } from "../model/sessionsStore";

const UNSAVED_NOTICE_ID = "queue-persistence-unsaved";

/**
 * Write each session's queued follow-ups through to the store the moment they
 * change (add, edit, remove, send), so a crash or kill loses nothing. A failed
 * write is retried on a backoff timer and, once it keeps failing, a persistent
 * notice says the queue is only in memory until a write succeeds.
 * Remote sessions have no app-side queue: their host owns the conversation.
 */
export function useQueuePersistence(): void {
  // One controller per mount, kept across a StrictMode remount so nothing is written twice.
  const [sync] = useState(() =>
    createQueuePersistenceSync({
      sessions: getShellSessions,
      write: (sessionId, queue) => setSessionQueue(sessionId, queue),
      onUnsavedChange: (unsaved, retry) => {
        if (!unsaved) {
          toast.dismiss(UNSAVED_NOTICE_ID);
          return;
        }
        toast.show({
          id: UNSAVED_NOTICE_ID,
          tone: "warning",
          title: t("Queued follow-ups not saved"),
          message: t("They are only kept in memory and will be lost if the app closes."),
          durationMs: null,
          action: { label: t("Retry"), onClick: retry },
        });
      },
    }),
  );
  // Follows the shell store for the app's lifetime; cleanup stops the retry timers and the notice.
  useEffect(() => {
    sync.start();
    const unsubscribe = subscribeShell(sync.sync);
    return () => {
      unsubscribe();
      sync.stop();
    };
  }, [sync]);
}
