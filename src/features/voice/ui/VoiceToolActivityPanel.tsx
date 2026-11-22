import { Spinner } from "../../../shared/ui/Spinner";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Divider } from "../../../shared/ui/Divider";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Heading } from "../../../shared/ui/Heading";
import { Wrench } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { formatDuration } from "../../../shared/i18n/format";
import { elapsedSince } from "../../../shared/lib/time/timestamps";
import { subscribeVoiceSecond } from "../model/voicePresentationTimers";
import type { VoiceToolActivityEntry } from "../model/voiceToolActivity";
import styles from "./VoiceToolActivityPanel.module.css";

const STATUS: Record<VoiceToolActivityEntry["state"], string> = {
  running: "Running",
  "waiting-owner": "Waiting for you",
  returned: "Done",
  failed: "Failed",
  uncertain: "Result unknown. Check before retrying.",
};

const STATUS_TONE: Record<VoiceToolActivityEntry["state"], TextTone> = {
  running: "secondary",
  "waiting-owner": "secondary",
  returned: "secondary",
  failed: "danger",
  uncertain: "warning",
};

/** "workspace.sessions.list" and "app_tools_list" read as "sessions list" and "tools list". */
export function voiceActionLabel(name: string) {
  return name.replace(/^(?:workspace|app|conversation)[._]/, "").replace(/[._]+/g, " ");
}

/** Shared action history for the companion and detached window. Status and duration
 * have their own slots so long tool names and uncertain outcomes stay readable. */
export function VoiceToolActivityPanel({
  entries,
  onStopWaiting,
  touchTarget,
}: {
  entries: readonly VoiceToolActivityEntry[];
  touchTarget?: "control";
  onStopWaiting: (id: string) => void;
}) {
  const [, refresh] = useState(0);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const running = entries.some(
    (entry) => entry.state === "running" || entry.state === "waiting-owner",
  );
  // Keep elapsed time current while an action is running or awaiting its owner.
  useEffect(() => {
    if (!running) return;
    return subscribeVoiceSecond(() => refresh((value) => value + 1));
  }, [running]);
  if (!entries.length) return null;
  const label = t(running ? "Taking action…" : "Voice actions");
  return (
    <>
      <Button
        touchTarget={touchTarget}
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
        {running ? <Spinner size="sm" /> : <Wrench className="icon-sm" />}
        <Text
          as="span"
          size="micro"
          leading="tight"
          tone="inherit"
          {...surfaceAttributes(
            running
              ? { radius: "pill", variant: "info-foreground" }
              : { radius: "pill", tone: "neutral", toneFill: "solid" },
            styles.count,
          )}
          aria-hidden="true"
        >
          {entries.length > 99 ? "99+" : entries.length}
        </Text>
      </Button>
      {anchor && (
        <Popover
          anchor={anchor}
          kind="dialog"
          aria-label={t("Voice actions")}
          variant="panel"
          width={340}
          flow="scroll"
          tabIndex={0}
          onDismiss={() => setAnchor(null)}
          className={styles.popover}
        >
          <div className={styles.header}>
            <Heading size="caption">{t("Voice actions")}</Heading>
            <Text size="caption" tone="muted">
              {entries.length}
            </Text>
          </div>
          <Divider decorative />
          <ul className={styles.list}>
            {entries.map((entry) => {
              const live = entry.state === "running" || entry.state === "waiting-owner";
              // The technical ids sit in the row's Details disclosure; the stop button's name keeps them so each action stays unique.
              const details = [entry.name, entry.target, entry.requestId]
                .filter(Boolean)
                .join(" · ");
              return (
                <li className={styles.row} data-state={entry.state} key={entry.id}>
                  <div className={styles.marker}>
                    {entry.state === "running" ? (
                      <Spinner size="sm" />
                    ) : (
                      <StatusDot
                        tone={
                          entry.state === "returned"
                            ? "muted"
                            : entry.state === "failed"
                              ? "danger"
                              : "warning"
                        }
                      />
                    )}
                  </div>
                  <div className={styles.details}>
                    <Text as="div" size="secondary" weight="medium" tone="primary" wrap="anywhere">
                      {voiceActionLabel(entry.name)}
                    </Text>
                    <Text
                      as="div"
                      size="caption"
                      leading="normal"
                      tone={STATUS_TONE[entry.state]}
                      wrap="anywhere"
                    >
                      {t(STATUS[entry.state])}
                    </Text>
                    {entry.target ? (
                      <Text as="div" size="caption" tone="muted" wrap="anywhere">
                        {entry.target}
                      </Text>
                    ) : null}
                    <Disclosure variant="plain" size="sm" summary={t("Details")}>
                      <Text as="div" size="caption" tone="muted" wrap="anywhere">
                        {[entry.name, entry.requestId].filter(Boolean).join(" · ")}
                      </Text>
                    </Disclosure>
                  </div>
                  <Text size="caption" tone="muted" className={styles.time}>
                    {formatDuration(entry.elapsedMs ?? elapsedSince(entry.startedAt))}
                  </Text>
                  {live && (
                    <Button
                      size="sm"
                      variant="ghost"
                      touchTarget={touchTarget}
                      className={styles.stop}
                      label={t("Stop waiting for {p0}", { p0: details })}
                      onClick={() => onStopWaiting(entry.id)}
                    >
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
