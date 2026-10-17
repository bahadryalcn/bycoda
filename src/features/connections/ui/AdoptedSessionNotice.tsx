import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import { ADOPTED_CONFLICT_MESSAGE, ADOPTED_RUNNING_REASON } from "../model/adoptedSessions";
import type { RefreshAdoptedSession } from "../model/useAdoptedSessions";

/** Keeps the composer mounted (and its draft/attachments intact) during refresh. */
export function AdoptedSessionNotice({
  session,
  onRefresh,
}: {
  session: Session;
  onRefresh?: RefreshAdoptedSession;
}) {
  useLocale();
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = setTimeout(() => setFeedback(undefined), 6_000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const refresh = async () => {
    if (!onRefresh || pending.current) return;
    pending.current = true;
    setRefreshing(true);
    setFeedback(undefined);
    try {
      const preserved = await onRefresh(session.id);
      setFeedback({
        error: false,
        text: preserved
          ? 'Conversation synced. Your previous version is saved in project history as "(local copy)".'
          : "Conversation synced.",
      });
    } catch {
      setFeedback({
        error: true,
        text: "Could not sync the conversation. Your messages were kept. Check the connection and try again.",
      });
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  };
  // An attached live turn already has a working indicator and Stop control.
  const backgroundRunning = session.continuingElsewhere && !session.busy;
  if (!backgroundRunning && !session.adoptedSyncConflict && !feedback && !refreshing) return null;
  return (
    <div
      role={session.adoptedSyncConflict || feedback?.error ? "alert" : "status"}
      className={`shrink-0 border-b px-4 py-2 text-xs text-(--ui-tone-neutral-fg) ${session.adoptedSyncConflict || feedback?.error ? "border-(--ui-tone-warning-border) bg-(--ui-tone-warning-subtle)" : "border-(--ui-tone-info-border) bg-(--ui-tone-info-subtle)"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {backgroundRunning ? <div role="status">{t(ADOPTED_RUNNING_REASON)}</div> : null}
          {session.adoptedSyncConflict ? <div>{t(ADOPTED_CONFLICT_MESSAGE)}</div> : null}
          {feedback ? <div>{t(feedback.text)}</div> : null}
        </div>
        {onRefresh && (session.adoptedSyncConflict || feedback?.error || refreshing) ? (
          <Button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || session.busy}
            aria-busy={refreshing}
            title={t(
              "Load the latest conversation. Save a separate copy in project history if your messages differ.",
            )}
            variant="secondary"
          >
            {refreshing
              ? t("Refreshing…")
              : feedback?.error
                ? t("Retry refresh")
                : t("Sync conversation")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
