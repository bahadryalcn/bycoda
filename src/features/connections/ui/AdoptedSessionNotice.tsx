import { Text } from "../../../shared/ui/Text";
import { Alert, type AlertProps } from "../../../shared/ui/Alert";
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
import { useAdoptedSyncFailure, useAdoptedSyncing } from "../model/adoptedSyncing";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { describeRemoteError, type RemoteErrorView } from "../model/remoteFailure";

/** The strip's own gutter above the composer; both states share it. */
const NOTICE_SLOT = "shrink-0 px-4 py-2";

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
  const automaticFailure = useAdoptedSyncFailure(session.id);
  const pending = useRef<{ sessionId: string } | undefined>(undefined);
  const [refreshingId, setRefreshingId] = useState<string>();
  const refreshing = refreshingId === session.id;
  const [confirmingId, setConfirmingId] = useState<string>();
  const [storedFeedback, setFeedback] = useState<{
    sessionId: string;
    conflicted: boolean;
    /** Why the sync did not finish, as the connection layer describes it. */
    failure?: RemoteErrorView;
    text: string;
  }>();
  const feedback =
    storedFeedback?.sessionId === session.id &&
    (!storedFeedback.failure || !storedFeedback.conflicted || session.adoptedSyncConflict)
      ? storedFeedback
      : undefined;
  useEffect(() => {
    if (!storedFeedback || feedback?.failure) return;
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
        text:
          resolution === "keep-both" && branched
            ? "Both versions are kept. This computer's version is saved as a new conversation in project history."
            : resolution === "keep-other"
              ? "Conversation synced. The other computer's version was kept."
              : "Conversation synced.",
      });
    } catch (reason) {
      if (pending.current !== attempt) return;
      // The retained transcript, drafts and queue stay as they are; the user sees why.
      setFeedback({
        sessionId: session.id,
        conflicted: !!session.adoptedSyncConflict,
        failure: describeRemoteError(reason),
        text: "",
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
  const failure =
    feedback?.failure ??
    (session.adoptedSyncConflict && !choosing && automaticFailure
      ? describeRemoteError(automaticFailure)
      : undefined);
  // Keeping this version drops what the other computer added, so it is asked
  // twice; Keep both is the way to keep it.
  const confirming = choosing && confirmingId === session.id;
  const keep = () => {
    setConfirmingId(undefined);
    setSessions((list) =>
      list.map((item) => (item.id === session.id ? keepAdoptedDivergence(item) : item)),
    );
  };
  if (!session.adoptedSyncConflict && !feedback && !refreshing)
    // The first comparison with the other computer's copy; a quick one shows nothing.
    return syncing ? (
      <div className={NOTICE_SLOT}>
        <LoadingText>{t("Syncing with the local Host…")}</LoadingText>
      </div>
    ) : null;
  // Only two versions that both moved on need attention; an unfinished sync is information.
  const attention = choosing || !!feedback?.failure;
  const showSync =
    !!onRefresh &&
    !choosing &&
    (!!session.adoptedSyncConflict || !!feedback?.failure || refreshing);
  const syncBlocked = refreshing || session.busy;
  // Up to three follow-ups: the two structured slots plus one Button in `extra`.
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
                : feedback?.failure
                  ? t("Retry refresh")
                  : t("Sync conversation"),
              onClick: () => void refresh(),
              disabled: syncBlocked,
              pending: refreshing,
            },
          }
        : {};
  const failureDetails =
    failure?.details && failure.details !== failure.message ? (
      <ErrorDetails title={failure.message} detail={failure.details} />
    ) : undefined;
  return (
    <div className={NOTICE_SLOT}>
      <Alert
        tone={attention ? "warning" : "info"}
        {...noticeActions}
        extra={noticeActions.extra ?? failureDetails}
      >
        <div className="min-w-0 space-y-1">
          {session.adoptedSyncConflict ? (
            <div>{t(choosing ? ADOPTED_CHOICE_MESSAGE : ADOPTED_UNSYNCED_MESSAGE)}</div>
          ) : null}
          {choosing ? (
            <Text as="div" size="inherit">
              {t(confirming ? ADOPTED_DISCARD_QUESTION : ADOPTED_CHOICE_CONSEQUENCES)}
            </Text>
          ) : null}
          {failure ? <div>{failure.message}</div> : null}
          {feedback && !feedback.failure ? <div>{t(feedback.text)}</div> : null}
        </div>
      </Alert>
    </div>
  );
}
