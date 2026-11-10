import { Spinner } from "../../../shared/ui/Spinner";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { useT } from "../../../shared/i18n";
import { sameProjectPath } from "../../projects/public/recents";
import {
  dismissSessionDeletionStatus,
  getSessionDeletionStatus,
  subscribeSessionDeletionStatus,
  type SessionDeletionStatus,
} from "../model/sessionDeletionStatus";
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
  const [elapsed, setElapsed] = useState(0);
  const pending = !status.outcome;
  useEffect(() => {
    if (!pending) return;
    const tick = () => setElapsed(Math.floor((Date.now() - status.startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pending, status.startedAt]);
  const stages = {
    preparing: t("Preparing deletion…"),
    stopping: t("Stopping conversation…"),
    provider: t("Closing agent processes…"),
    checkpoint: t("Finishing pending saves…"),
    deleting: t("Deleting conversation data…"),
    worktree: t("Conversation deleted. Removing worktree…"),
  };
  return (
    <div className="shrink-0 border-b border-stroke px-3 py-2" data-session-deletion-detail>
      <Alert
        inline
        tone={
          pending
            ? "info"
            : status.outcome === "failed"
              ? "danger"
              : status.error
                ? "warning"
                : "success"
        }
        icon={pending ? <Spinner size="sm" /> : undefined}
        onDismiss={pending ? undefined : () => dismissSessionDeletionStatus(status.sessionId)}
      >
        <span className="min-w-0 break-words">
          <span className="block">{status.title}</span>
          <span className="block text-ui-caption text-(--ui-text-secondary)">
            {pending
              ? stages[status.stage]
              : status.outcome === "failed"
                ? t("Could not delete conversation. Try again from its menu.")
                : status.error
                  ? t("Conversation deleted. Its worktree was kept.")
                  : t("Conversation deleted.")}
          </span>
          {status.error ? (
            <span className="block break-words text-ui-caption">{status.error}</span>
          ) : null}
        </span>
      </Alert>
      {pending && elapsed >= 10 ? (
        <span
          className="block text-ui-caption text-(--ui-text-secondary) tabular-nums"
          aria-hidden="true"
        >
          {t("Still working… {p0}s elapsed", { p0: elapsed })}
        </span>
      ) : null}
    </div>
  );
}
