import { useEffect, useRef } from "react";
import { Button } from "../../../../shared/ui/Button";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import { Globe, MessageMultiple, Square } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { formatDuration } from "../../../../shared/i18n/format";
import { elapsedSince, monotonicNow } from "../../../../shared/lib/time/timestamps";
import { subscribeVoiceSecond } from "../../model/voicePresentationTimers";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import { VoiceCallScene } from "./VoiceCallScene";
import { voiceStatusTone } from "./VoiceLauncher";
import type { VoiceCallArtworkState } from "./voiceCallArtwork";
import styles from "./VoiceCompanionParts.module.css";

/**
 * Fullscreen keeps its call stage while the transcript is open. The floating panel can fit its
 * transcript by switching to the status strip.
 */
export function VoiceCompanionStatus({
  visualState,
  artwork,
  fullScreen,
  working,
  audioLevel,
  statusText,
  sessionStatusText,
  live,
  engine,
  privacy,
  workspace,
  globalScope,
  stage,
  caption,
  onScopeChange,
  onStopWork,
}: {
  visualState: VoiceVisualState;
  artwork: VoiceCallArtworkState;
  fullScreen?: boolean;
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
  /** Show the large call stage. */
  stage: boolean;
  /** The latest spoken line, shown under the status on the large stage. */
  caption: string;
  onScopeChange: (global: boolean) => void;
  onStopWork: () => void;
}) {
  const tone = voiceStatusTone(visualState);
  const work = working ? sessionStatusText : "";
  return (
    <div
      className={styles.stage}
      data-layout={stage ? "stage" : "strip"}
      data-full-call={fullScreen || undefined}
    >
      <div className={styles.status}>
        <VoiceCallScene
          part="orb"
          state={artwork}
          level={audioLevel}
          expanded={fullScreen}
          size={stage ? "stage" : "strip"}
        />
        <div className={styles.statusText}>
          <div className={styles.statusLine}>
            {tone && <StatusDot tone={tone} size="fixed" appearance="solid" />}
            <LiveText
              size={fullScreen ? "heading" : stage ? "body" : "secondary"}
              weight="medium"
              leading="snug"
              lines={fullScreen ? 2 : undefined}
              truncate={!fullScreen}
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
      {stage && (fullScreen || caption) ? (
        <div className={styles.captionSlot}>
          {caption && (
            <Text
              as="p"
              size={fullScreen ? "body" : "secondary"}
              tone="secondary"
              leading="normal"
              lines={fullScreen ? 2 : 4}
              className={styles.spoken}
            >
              {caption}
            </Text>
          )}
        </div>
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
 * One quiet line under the status: the engine (its info popover says where audio goes) and, while
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
      <Text size="caption" tone="muted" leading="none" truncate>
        {engine}
      </Text>
      <InfoPopover label={t("Privacy")}>
        <p>{privacy}</p>
      </InfoPopover>
      {live ? (
        <Text ref={clock} size="caption" tone="muted" leading="none" className={styles.clock} />
      ) : null}
    </div>
  );
}
