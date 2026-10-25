import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { Loader } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { sameProjectPath } from "../../projects/model/recents";
import {
  dismissSessionDeletionStatus,
  getSessionDeletionStatus,
  subscribeSessionDeletionStatus,
  type SessionDeletionStatus,
} from "../model/sessionDeletionStatus";

export function SessionDeletionNotice({ cwd }: { cwd: string }) {
  const statuses = useSyncExternalStore(subscribeSessionDeletionStatus, getSessionDeletionStatus);
  return statuses
    .filter((status) => sameProjectPath(status.cwd, cwd))
    .map((status) => <DeletionNotice key={status.sessionId} status={status} />);
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
        icon={
          pending ? <Loader className="icon-sm motion-safe:animate-spin" aria-hidden /> : undefined
        }
        role={status.outcome === "failed" ? "alert" : "status"}
        aria-live={status.outcome === "failed" ? "assertive" : "polite"}
        aria-atomic="true"
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
