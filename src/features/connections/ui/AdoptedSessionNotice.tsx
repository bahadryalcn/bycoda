import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import { getSessions, setSessions } from "../../sessions/model/sessionsStore";
import {
  ADOPTED_CHOICE_CONSEQUENCES,
  ADOPTED_CHOICE_MESSAGE,
  ADOPTED_CONFLICT_MESSAGE,
  ADOPTED_DISCARD_QUESTION,
  ADOPTED_RUNNING_REASON,
  keepAdoptedDivergence,
  type AdoptedResolution,
} from "../model/adoptedSessions";
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
  const [confirmingId, setConfirmingId] = useState<string>();
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
  const refresh = async (resolution?: AdoptedResolution) => {
    if (!onRefresh || pending.current?.sessionId === session.id) return;
    const attempt = { sessionId: session.id };
    pending.current = attempt;
    setRefreshingId(session.id);
    setFeedback(undefined);
    try {
      const branched = await (resolution
        ? onRefresh(session.id, undefined, resolution)
        : onRefresh(session.id));
      if (pending.current !== attempt) return;
      // A sync that found two changed versions leaves them for the choice below.
      if (!resolution && getSessions().find((item) => item.id === session.id)?.adoptedSyncConflict)
        return;
      setFeedback({
        sessionId: session.id,
        conflicted: !!session.adoptedSyncConflict,
        error: false,
        text:
          resolution === "keep-both" && branched
            ? "Both versions are kept. This computer's version is saved as a new conversation in project history."
            : resolution === "keep-other"
              ? "Conversation synced. The other computer's version was kept."
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
  // Two versions that both moved on from the one they shared are the user's to
  // answer. Nothing is replaced or copied until they do.
  const choosing =
    !!session.adoptedSyncConflict && !!session.adoptedDivergence && !session.adoptedDivergence.keep;
  // Keeping this version drops what the other computer added, so it is asked
  // twice; Keep both is the way to keep it.
  const confirming = choosing && confirmingId === session.id;
  const keep = () => {
    setConfirmingId(undefined);
    setSessions((list) =>
      list.map((item) => (item.id === session.id ? keepAdoptedDivergence(item) : item)),
    );
  };
  if (!session.adoptedSyncConflict && !feedback && !refreshing) return null;
  return (
    <div
      role={session.adoptedSyncConflict || feedback?.error ? "alert" : "status"}
      className={`shrink-0 border-b px-4 py-2 text-xs text-(--ui-tone-neutral-fg) ${session.adoptedSyncConflict || feedback?.error ? "border-(--ui-tone-warning-border) bg-(--ui-tone-warning-subtle)" : "border-(--ui-tone-info-border) bg-(--ui-tone-info-subtle)"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {session.adoptedSyncConflict ? (
            <div>{t(choosing ? ADOPTED_CHOICE_MESSAGE : ADOPTED_CONFLICT_MESSAGE)}</div>
          ) : null}
          {choosing ? (
            <div className="text-(--ui-text-secondary)">
              {t(confirming ? ADOPTED_DISCARD_QUESTION : ADOPTED_CHOICE_CONSEQUENCES)}
            </div>
          ) : null}
          {feedback ? <div>{t(feedback.text)}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {confirming ? (
            <>
              <Button
                key="discard"
                type="button"
                onClick={keep}
                disabled={refreshing}
                variant="danger"
              >
                {t("Discard and keep this")}
              </Button>
              {onRefresh ? (
                <Button
                  key="both"
                  type="button"
                  onClick={() => void refresh("keep-both")}
                  disabled={refreshing || session.busy}
                  aria-busy={refreshing}
                  title={t(
                    "Keep the other version here and save this computer's version as a new conversation.",
                  )}
                  variant="secondary"
                >
                  {t("Keep both")}
                </Button>
              ) : null}
              <Button
                key="back"
                type="button"
                onClick={() => setConfirmingId(undefined)}
                disabled={refreshing}
                variant="ghost"
              >
                {t("Back")}
              </Button>
            </>
          ) : choosing ? (
            <>
              <Button
                key="keep-this"
                type="button"
                onClick={() => setConfirmingId(session.id)}
                disabled={refreshing}
                title={t(
                  "Keep this computer's version. The other computer catches up with it. Nothing is copied.",
                )}
                variant="ghost"
              >
                {t("Keep this")}
              </Button>
              {onRefresh ? (
                <>
                  <Button
                    type="button"
                    onClick={() => void refresh("keep-other")}
                    disabled={refreshing || session.busy}
                    aria-busy={refreshing}
                    title={t(
                      "Replace this computer's version with the other one. Changes made only here are discarded.",
                    )}
                    variant="ghost"
                  >
                    {t("Keep other")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void refresh("keep-both")}
                    disabled={refreshing || session.busy}
                    aria-busy={refreshing}
                    title={t(
                      "Keep the other version here and save this computer's version as a new conversation.",
                    )}
                    variant="secondary"
                  >
                    {t("Keep both")}
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
          {onRefresh &&
          !choosing &&
          (session.adoptedSyncConflict || feedback?.error || refreshing) ? (
            <Button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || session.busy}
              aria-busy={refreshing}
              title={t("Load the latest conversation and compare it with this one.")}
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
    </div>
  );
}
