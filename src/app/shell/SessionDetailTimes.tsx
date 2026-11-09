import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { formatDate, useT } from "../../shared/i18n";
import { formatDuration } from "../../shared/i18n/format";
import { useMinuteNow } from "../../shared/hooks/useMinuteNow";
import { useSession } from "../../features/sessions/public/sessionsStore";
import { sessionWorkedMs } from "../../features/sessions/public/sessionActivity";
import { isRemoteProjectPath } from "../../features/projects/model/recents";
import { loadRemoteWorkedMs } from "../../features/connections/model/remoteWorkedTime";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";

/** Last activity and total working time for the session detail card. */
export function SessionDetailTimes({
  session,
  runningSince,
}: {
  session: SessionSummary;
  /** Start of the turn still running, added to the finished turns. */
  runningSince?: number;
}) {
  const t = useT();
  const now = useMinuteNow(runningSince !== undefined);
  const live = useSession(session.id);
  const loaded = live && !live.historyPartial && !live.historyLoading ? live : undefined;
  const [stored, setStored] = useState<number | null>(null);
  const canRead = !loaded && isTauri();
  const remote = isRemoteProjectPath(session.cwd);
  useEffect(() => {
    if (!canRead) return;
    let current = true;
    // The card mounts on hover, so each open reads one session's turn metadata from
    // its owner: the local store, or the Host of a remote project.
    (remote
      ? loadRemoteWorkedMs(session.cwd, session.id)
      : invoke<number>("session_worked_ms", { sessionId: session.id })
    ).then(
      (ms) => {
        if (current) setStored(ms);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [canRead, remote, session.cwd, session.id]);
  const finished = loaded ? sessionWorkedMs(loaded) : canRead ? stored : null;
  const worked =
    finished === null
      ? null
      : finished + (runningSince !== undefined ? Math.max(0, now - runningSince) : 0);

  return (
    <div className="mt-2 grid gap-0.5 text-ui-caption text-(--ui-text-secondary)">
      <p>
        {t("Last activity: {p0}", {
          p0: formatDate(session.lastActivityAt ?? session.updatedAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })}
      </p>
      {worked ? (
        <p className="tabular-nums">{t("Total work time: {p0}", { p0: formatDuration(worked) })}</p>
      ) : null}
    </div>
  );
}
