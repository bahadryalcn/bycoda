import { t, useLocale } from "../../../shared/i18n";
import { useRef, useState } from "react";
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
          ? 'Updated from host. Your previous conversation is saved in project history as "(local copy)".'
          : "Updated from host.",
      });
    } catch (error) {
      setFeedback({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "Could not refresh from host. Check the connection and try again.",
      });
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  };
  if (!session.continuingElsewhere && !session.adoptedSyncConflict && !feedback && !refreshing)
    return null;
  return (
    <div
      className={`shrink-0 border-b px-4 py-2 text-xs text-content/80 ${session.adoptedSyncConflict || feedback?.error ? "border-amber-400/20 bg-amber-400/5" : "border-accent/20 bg-accent/5"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {session.continuingElsewhere ? (
            <div role="status">
              {t("Working on host. ")}
              {ADOPTED_RUNNING_REASON}
            </div>
          ) : null}
          {session.adoptedSyncConflict ? <div role="alert">{ADOPTED_CONFLICT_MESSAGE}</div> : null}
          {feedback ? <div role={feedback.error ? "alert" : "status"}>{feedback.text}</div> : null}
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || session.busy}
            aria-busy={refreshing}
            title={
              session.adoptedSyncConflict
                ? t("Save a separate local copy, then load the latest host conversation.")
                : t("Load the latest conversation and status from the host.")
            }
            className="shrink-0 rounded border border-stroke px-2.5 py-1.5 font-medium hover:bg-selection-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50"
          >
            {refreshing
              ? t("Refreshing…")
              : feedback?.error
                ? t("Retry refresh")
                : t("Refresh from host")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
