import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { Wrench } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { formatDuration } from "../../../shared/i18n/format";
import { elapsedSince } from "../../../shared/lib/time/timestamps";
import type { VoiceToolActivityEntry } from "../model/voiceToolActivity";
import styles from "./VoiceToolActivityPanel.module.css";

const STATUS: Record<VoiceToolActivityEntry["state"], string> = {
  running: "Running",
  "waiting-owner": "Waiting for you",
  returned: "Done",
  failed: "Failed",
  uncertain: "Result unknown. Check before retrying.",
};

/** "workspace.sessions.list" and "app_tools_list" read as "sessions list" and "tools list". */
export function voiceActionLabel(name: string) {
  return name.replace(/^(?:workspace|app|conversation)[._]/, "").replace(/[._]+/g, " ");
}

/** Voice actions: an icon button with a count badge, so the header title keeps its width; the
 * list opens in a popover. The icon breathes while an action runs. */
export function VoiceToolActivityPanel({
  entries,
  onStopWaiting,
}: {
  entries: readonly VoiceToolActivityEntry[];
  onStopWaiting: (id: string) => void;
}) {
  const [, refresh] = useState(0);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const running = entries.some(
    (entry) => entry.state === "running" || entry.state === "waiting-owner",
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => refresh((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!entries.length) return null;
  const label = t(running ? "Taking action…" : "Voice actions");
  return (
    <>
      <Button
        iconOnly
        variant="ghost"
        className={styles.trigger}
        data-running={running || undefined}
        label={`${label} (${entries.length})`}
        tooltip={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Wrench className="icon-sm" />
        <span className={styles.count} aria-hidden="true">
          {entries.length > 99 ? "99+" : entries.length}
        </span>
      </Button>
      {anchor && (
        <Popover
          anchor={anchor}
          role="dialog"
          aria-label={t("Voice actions")}
          width={300}
          flow="scroll"
          tabIndex={-1}
          onDismiss={() => setAnchor(null)}
          className={styles.popover}
        >
          <ul className={styles.list}>
            {entries.map((entry) => {
              const live = entry.state === "running" || entry.state === "waiting-owner";
              return (
                <li
                  className={styles.row}
                  data-state={entry.state}
                  key={entry.id}
                  title={[entry.name, entry.target, entry.requestId].filter(Boolean).join(" · ")}
                >
                  <span className={styles.name}>{voiceActionLabel(entry.name)}</span>
                  <span className={styles.status}>{t(STATUS[entry.state])}</span>
                  <span className={styles.time}>
                    {formatDuration(entry.elapsedMs ?? elapsedSince(entry.startedAt))}
                  </span>
                  {live && (
                    <Button size="sm" variant="ghost" onClick={() => onStopWaiting(entry.id)}>
                      {t("Stop waiting")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Popover>
      )}
    </>
  );
}
