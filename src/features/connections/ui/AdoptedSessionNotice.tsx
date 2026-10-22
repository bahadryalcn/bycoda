import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import { ADOPTED_CONFLICT_MESSAGE, ADOPTED_RUNNING_REASON } from "../model/adoptedSessions";
import type { RefreshAdoptedSession } from "../model/useAdoptedSessions";

/** Background execution belongs with the pane actions, without a notice row. */
export function BackgroundSessionIndicator({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useLocale();
  if (!session.continuingElsewhere || session.busy) return null;
  return (
    <span className="inline-flex shrink-0" data-no-drag>
      <Button
        ref={anchor}
        variant="ghost"
        iconOnly
        label={t(ADOPTED_RUNNING_REASON)}
        aria-expanded={open}
        aria-haspopup="dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
      >
        <WorkingIndicator />
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          align="end"
          width={280}
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={t(ADOPTED_RUNNING_REASON)}
        >
          <p className="p-3 text-xs text-(--ui-text-secondary)">{t(ADOPTED_RUNNING_REASON)}</p>
        </Popover>
      ) : null}
    </span>
  );
}

/** Keeps the composer mounted (and its draft/attachments intact) during refresh. */
export function AdoptedSessionNotice({
  session,
  onRefresh,
}: {
  session: Session;
  onRefresh?: RefreshAdoptedSession;
}) {
  useLocale();
  const pending = useRef<{ sessionId: string } | undefined>(undefined);
  const [refreshingId, setRefreshingId] = useState<string>();
  const refreshing = refreshingId === session.id;
  const [storedFeedback, setFeedback] = useState<{
    sessionId: string;
    conflicted: boolean;
    error: boolean;
    text: string;
  }>();
  const feedback =
    storedFeedback?.sessionId === session.id &&
    (!storedFeedback.error || !storedFeedback.conflicted || session.adoptedSyncConflict)
      ? storedFeedback
      : undefined;
  useEffect(() => {
    if (!storedFeedback || feedback?.error) return;
    const timer = setTimeout(() => setFeedback(undefined), feedback ? 6_000 : 0);
    return () => clearTimeout(timer);
  }, [feedback, storedFeedback]);
  const refresh = async () => {
    if (!onRefresh || pending.current?.sessionId === session.id) return;
    const attempt = { sessionId: session.id };
    pending.current = attempt;
    setRefreshingId(session.id);
    setFeedback(undefined);
    try {
      const preserved = await onRefresh(session.id);
      if (pending.current !== attempt) return;
      setFeedback({
        sessionId: session.id,
        conflicted: !!session.adoptedSyncConflict,
        error: false,
        text: preserved
          ? 'Conversation synced. Your previous version is saved in project history as "(local copy)".'
          : "Conversation synced.",
      });
    } catch {
      if (pending.current !== attempt) return;
      setFeedback({
        sessionId: session.id,
        conflicted: !!session.adoptedSyncConflict,
        error: true,
        text: "Could not sync the conversation. Your messages were kept. Check the connection and try again.",
      });
    } finally {
      if (pending.current === attempt) {
        pending.current = undefined;
        setRefreshingId(undefined);
      }
    }
  };
  if (!session.adoptedSyncConflict && !feedback && !refreshing) return null;
  return (
    <div
      role={session.adoptedSyncConflict || feedback?.error ? "alert" : "status"}
      className={`shrink-0 border-b px-4 py-2 text-xs text-(--ui-tone-neutral-fg) ${session.adoptedSyncConflict || feedback?.error ? "border-(--ui-tone-warning-border) bg-(--ui-tone-warning-subtle)" : "border-(--ui-tone-info-border) bg-(--ui-tone-info-subtle)"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
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
