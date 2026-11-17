import { Text } from "../../../shared/ui/Text";
import { Alert, type AlertProps } from "../../../shared/ui/Alert";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../sessions";
import { getSessions, setSessions } from "../../sessions/public/sessionsStore";
import {
  ADOPTED_CHOICE_CONSEQUENCES,
  ADOPTED_CHOICE_MESSAGE,
  ADOPTED_DISCARD_QUESTION,
  ADOPTED_UNSYNCED_MESSAGE,
  keepAdoptedDivergence,
  type AdoptedResolution,
} from "../model/adoptedSessions";
import type { RefreshAdoptedSession } from "../model/useAdoptedSessions";
import { useAdoptedSyncing } from "../model/adoptedSyncing";
import { LoadingText } from "../../../shared/ui/LoadingText";

/** Keeps the composer mounted (and its draft/attachments intact) during refresh. */
export function AdoptedSessionNotice({
  session,
  onRefresh,
}: {
  session: Session;
  onRefresh?: RefreshAdoptedSession;
}) {
  useLocale();
  const syncing = useAdoptedSyncing(session.id);
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
  // Host execution itself is shown by RemoteOriginMark in the composer
  // workspace row; a row appears only when it holds back the user's queued messages.
  const queueWaiting =
    !!session.continuingElsewhere &&
    !session.busy &&
    isUserConversation(session) &&
    !!session.queuedMessages?.length;
  if (!session.adoptedSyncConflict && !feedback && !refreshing && !queueWaiting)
    // The first comparison with the other computer's copy; a quick one shows nothing.
    return syncing ? (
      <div className="shrink-0 px-4 py-2">
        <LoadingText>{t("Syncing with the other computer…")}</LoadingText>
      </div>
    ) : null;
  // Only two versions that both moved on need attention; an unfinished sync is information.
  const attention = choosing || !!feedback?.error;
  const showSync =
    !!onRefresh && !choosing && (!!session.adoptedSyncConflict || !!feedback?.error || refreshing);
  const syncBlocked = refreshing || session.busy;
  const keepBothTooltip = t(
    "Keep the other version here and save this computer's version as a new conversation.",
  );
  // Up to three follow-ups: the two structured slots plus one Button in `extra` (it keeps its tooltip).
  const noticeActions: Pick<AlertProps, "action" | "secondaryAction" | "extra"> = confirming
    ? {
        action: { label: t("Discard and keep this"), onClick: keep, disabled: refreshing },
        secondaryAction: {
          label: t("Back"),
          onClick: () => setConfirmingId(undefined),
          disabled: refreshing,
        },
        extra: onRefresh ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void refresh("keep-both")}
            disabled={syncBlocked}
            aria-busy={refreshing}
            tooltip={keepBothTooltip}
          >
            {t("Keep both")}
          </Button>
        ) : undefined,
      }
    : choosing
      ? {
          action: onRefresh
            ? {
                label: t("Keep both"),
                onClick: () => void refresh("keep-both"),
                disabled: syncBlocked,
              }
            : {
                label: t("Keep this"),
                onClick: () => setConfirmingId(session.id),
                disabled: refreshing,
              },
          secondaryAction: onRefresh
            ? {
                label: t("Keep other"),
                onClick: () => void refresh("keep-other"),
                disabled: syncBlocked,
              }
            : undefined,
          extra: onRefresh ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingId(session.id)}
              disabled={refreshing}
              tooltip={t(
                "Keep this computer's version. The other computer catches up with it. Nothing is copied.",
              )}
            >
              {t("Keep this")}
            </Button>
          ) : undefined,
        }
      : onRefresh && showSync
        ? {
            action: {
              label: refreshing
                ? t("Refreshing…")
                : feedback?.error
                  ? t("Retry refresh")
                  : t("Sync conversation"),
              onClick: () => void refresh(),
              disabled: syncBlocked,
              pending: refreshing,
            },
          }
        : {};
  return (
    <div className="shrink-0 px-4 py-2">
      <Alert tone={attention ? "warning" : "info"} {...noticeActions}>
        <div className="min-w-0 space-y-1">
          {queueWaiting && !session.adoptedSyncConflict ? (
            <div>{t("Queue is waiting for the current turn to finish.")}</div>
          ) : null}
          {session.adoptedSyncConflict ? (
            <div>{t(choosing ? ADOPTED_CHOICE_MESSAGE : ADOPTED_UNSYNCED_MESSAGE)}</div>
          ) : null}
          {choosing ? (
            <Text as="div" size="inherit">
              {t(confirming ? ADOPTED_DISCARD_QUESTION : ADOPTED_CHOICE_CONSEQUENCES)}
            </Text>
          ) : null}
          {feedback ? <div>{t(feedback.text)}</div> : null}
        </div>
      </Alert>
    </div>
  );
}
