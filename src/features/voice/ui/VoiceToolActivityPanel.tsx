import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import { formatDuration } from "../../../shared/i18n/format";
import { elapsedSince } from "../../../shared/lib/time/timestamps";
import type { VoiceToolActivityEntry } from "../model/voiceToolActivity";
import styles from "./VoiceToolActivityPanel.module.css";

export function VoiceToolActivityPanel({
  entries,
  onStopWaiting,
}: {
  entries: readonly VoiceToolActivityEntry[];
  onStopWaiting: (id: string) => void;
}) {
  const [, refresh] = useState(0);
  const running = entries.some(
    (entry) => entry.state === "running" || entry.state === "waiting-owner",
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => refresh((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!entries.length) return null;
  return (
    <details
      className={styles.panel}
      open={running || entries.some((entry) => entry.state === "uncertain")}
    >
      <summary>{t("Voice actions")}</summary>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li className={styles.row} key={entry.id}>
            <div>
              <strong>{entry.name}</strong>
              {" · "}
              {entry.target}
              {" · "}
              {formatDuration(entry.elapsedMs ?? elapsedSince(entry.startedAt))}
            </div>
            <p className={styles.status}>
              {t(
                entry.state === "running" || entry.state === "waiting-owner"
                  ? entry.state === "waiting-owner"
                    ? "Waiting for your response"
                    : "Waiting for result"
                  : entry.state === "uncertain"
                    ? "Result unknown. Check before retrying."
                    : entry.state === "failed"
                      ? "Action failed"
                      : "Result received",
              )}
              {entry.outcome ? ` (${entry.outcome})` : ""}
            </p>
            {entry.requestId && <small className={styles.meta}>{entry.requestId}</small>}
            {(entry.state === "running" || entry.state === "waiting-owner") && (
              <Button onClick={() => onStopWaiting(entry.id)}>{t("Stop waiting")}</Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
