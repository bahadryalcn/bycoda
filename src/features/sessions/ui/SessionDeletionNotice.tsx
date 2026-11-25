import { Text } from "../../../shared/ui/Text";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { sameProjectPath } from "../../projects/public/recents";
import {
  dismissSessionDeletionStatus,
  getSessionDeletionStatus,
  subscribeSessionDeletionStatus,
  type SessionDeletionStatus,
} from "../model/sessionDeletionStatus";
import { usePresentationNow } from "./AgentClock";
import { NoticeActionButton, TranscriptNotice } from "./TranscriptNotice";
import { RemoteActivityNotices } from "./RemoteActivityNotices";
import {
  SessionBulkDeletionNotice,
  type SessionBulkDeletionFeedback,
} from "./SessionBulkDeletionNotice";

export function SessionDeletionNotice({
  cwd,
  bulk,
}: {
  cwd: string;
  bulk?: SessionBulkDeletionFeedback;
}) {
  const statuses = useSyncExternalStore(subscribeSessionDeletionStatus, getSessionDeletionStatus);
  const current = statuses.find(
    (status) =>
      sameProjectPath(status.cwd, cwd) &&
      !status.outcome &&
      bulk?.progress?.sessionIds.includes(status.sessionId),
  );
  return (
    <>
      {bulk ? <SessionBulkDeletionNotice feedback={bulk} title={current?.title} /> : null}
      {statuses
        .filter((status) => sameProjectPath(status.cwd, cwd))
        .filter((status) => !bulk?.progress?.sessionIds.includes(status.sessionId))
        .map((status) => (
          <DeletionNotice key={status.sessionId} status={status} />
        ))}
      <RemoteActivityNotices cwd={cwd} />
    </>
  );
}

function DeletionNotice({ status }: { status: SessionDeletionStatus }) {
  const t = useT();
  const pending = !status.outcome;
  const now = usePresentationNow(pending);
  const elapsed = Math.max(0, Math.floor((now - status.startedAt) / 1000));
  const onDismissStatus = () => dismissSessionDeletionStatus(status.sessionId);
  const stages = {
    preparing: t("Preparing deletion…"),
    stopping: t("Stopping conversation…"),
    provider: t("Closing agent processes…"),
    checkpoint: t("Finishing pending saves…"),
    deleting: t("Deleting conversation data…"),
    worktree: t("Conversation deleted. Removing worktree…"),
  };
  return (
    <div className="shrink-0 px-3 py-1" data-session-deletion-detail>
      <TranscriptNotice
        kind={
          pending
            ? "info"
            : status.outcome === "failed"
              ? "error"
              : status.error
                ? "warning"
                : "success"
        }
        trying={pending}
        title={status.title}
        detail={
          pending
            ? stages[status.stage]
            : status.outcome === "failed"
              ? t("Could not delete conversation. Try again from its menu.")
              : status.error
                ? t("Conversation deleted. Its worktree was kept.")
                : t("Conversation deleted.")
        }
        extra={
          status.error ? <ErrorDetails title={status.title} detail={status.error} /> : undefined
        }
        actions={
          pending ? undefined : (
            <NoticeActionButton action={{ label: t("Dismiss"), onClick: onDismissStatus }} quiet />
          )
        }
      />
      {pending && elapsed >= 10 ? (
        <Text size="caption" tone="secondary" className="block tabular-nums" aria-hidden="true">
          {t("Still working… {p0}s elapsed", { p0: elapsed })}
        </Text>
      ) : null}
    </div>
  );
}
