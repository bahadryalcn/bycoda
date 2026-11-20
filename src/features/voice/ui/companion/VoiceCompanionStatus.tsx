import { useEffect, useRef } from "react";
import { Button } from "../../../../shared/ui/Button";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { OverflowTooltip, Tooltip } from "../../../../shared/ui/Tooltip";
import { Globe, MessageMultiple, Square } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { formatDuration } from "../../../../shared/i18n/format";
import { elapsedSince, monotonicNow } from "../../../../shared/lib/time/timestamps";
import { subscribeVoiceSecond } from "../../model/voicePresentationTimers";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import { VoiceCallScene } from "./VoiceCallScene";
import { VoiceCore } from "./VoiceCore";
import { voiceStatusTone } from "./VoiceLauncher";
import styles from "./VoiceCompanionParts.module.css";

/**
 * With the transcript hidden, the expanded panel
 * is a call screen: a large voice core, the status, the engine and session clock, and the words
 * in flight. With the transcript shown it shrinks to a strip: the small core beside the status.
 * The scope choice sits under both, so no state moves another control.
 */
export function VoiceCompanionStatus({
  visualState,
  working,
  audioLevel,
  statusText,
  sessionStatusText,
  live,
  engine,
  privacy,
  workspace,
  globalScope,
  name,
  avatar,
  stage,
  caption,
  onScopeChange,
  onStopWork,
}: {
  visualState: VoiceVisualState;
  working: boolean;
  audioLevel: { readonly current: number };
  statusText: string;
  sessionStatusText: string;
  /** Connected and capturing; shows the session clock. */
  live: boolean;
  /** Who runs the voice: the realtime provider or this computer. */
  engine: string;
  /** Where audio goes; the engine's tooltip. */
  privacy: string;
  workspace: boolean;
  globalScope: boolean;
  /** Assistant name; empty before setup, when there is no avatar to show. */
  name: string;
  avatar: string | undefined;
  /** The transcript is hidden: show the large call stage. */
  stage: boolean;
  /** The latest spoken line, shown under the status on the large stage. */
  caption: string;
  onScopeChange: (global: boolean) => void;
  onStopWork: () => void;
}) {
  const tone = voiceStatusTone(visualState);
  const work = working ? sessionStatusText : "";
  return (
    <div className={styles.stage} data-layout={stage ? "stage" : "strip"}>
      <div className={styles.status}>
        {stage ? (
          <VoiceCallScene part="orb" state={visualState} level={audioLevel} />
        ) : (
          <VoiceCore state={visualState} level={audioLevel} name={name} avatar={avatar} />
        )}
        <div className={styles.statusText}>
          <div className={styles.statusLine}>
            {tone && <StatusDot tone={tone} size="fixed" appearance="solid" />}
            <LiveText
              size={stage ? "body" : "secondary"}
              weight="medium"
              leading="snug"
              truncate
              text={statusText}
            />
            {working && (
              <Button
                iconOnly
                size="sm"
                variant="ghost"
                label={t("Stop work")}
                onClick={onStopWork}
                className={styles.statusEnd}
              >
                <Square className="icon-sm" />
              </Button>
            )}
          </div>
          {work ? (
            <OverflowTooltip label={work}>
              <Text as="span" size="caption" tone="secondary" leading="snug" truncate>
                {work}
              </Text>
            </OverflowTooltip>
          ) : null}
          <VoiceMeta live={live} engine={engine} privacy={privacy} />
        </div>
      </div>
      {stage && caption ? (
        <Text
          as="p"
          size="secondary"
          tone="secondary"
          leading="normal"
          lines={4}
          className={styles.spoken}
        >
          {caption}
        </Text>
      ) : null}
      {workspace && (
        <div className={styles.scope}>
          <SegmentedControl
            label={t("Voice scope")}
            value={globalScope ? "global" : "session"}
            onValueChange={(value) => onScopeChange(value === "global")}
            options={[
              { value: "global", label: t("Global"), icon: <Globe className="icon-sm" /> },
              {
                value: "session",
                label: t("Project"),
                icon: <MessageMultiple className="icon-sm" />,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One quiet line under the status: the engine (its tooltip says where audio goes) and, while
 * connected, how long this voice session has run. The clock is painted from the shared second
 * timer, so it does not re-render the panel; the voice core already shows the input level.
 */
function VoiceMeta({ live, engine, privacy }: { live: boolean; engine: string; privacy: string }) {
  const clock = useRef<HTMLSpanElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- session clock timer runs only while voice is live
  useEffect(() => {
    if (!live) return;
    const start = monotonicNow();
    const tick = () => {
      if (clock.current)
        clock.current.textContent = formatDuration(elapsedSince(start), { style: "clock" });
    };
    tick();
    // Shared one-second timer: asleep while the window is hidden, caught up when it returns.
    return subscribeVoiceSecond(tick);
  }, [live]);
  return (
    <div className={styles.meta}>
      <Tooltip asChild label={privacy}>
        <Text size="caption" tone="muted" leading="none" truncate tabIndex={0}>
          {engine}
        </Text>
      </Tooltip>
      {live ? (
        <Text ref={clock} size="caption" tone="muted" leading="none" className={styles.clock} />
      ) : null}
    </div>
  );
}
