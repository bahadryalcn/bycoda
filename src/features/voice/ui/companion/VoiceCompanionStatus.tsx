import type { ReactNode } from "react";
import { Button } from "../../../../shared/ui/Button";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import { Square } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
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
  privacy,
  scope,
  stage,
  caption,
  onStopWork,
}: {
  visualState: VoiceVisualState;
  artwork: VoiceCallArtworkState;
  fullScreen?: boolean;
  working: boolean;
  audioLevel: { readonly current: number };
  statusText: string;
  sessionStatusText: string;
  /** Where audio goes, only when it leaves this computer; empty for local voice. */
  privacy: string;
  scope?: ReactNode;
  /** Show the large call stage. */
  stage: boolean;
  /** The latest spoken line, shown under the status on the large stage. */
  caption: string;
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
          {privacy ? (
            <div className={styles.meta}>
              <InfoPopover label={t("Privacy")}>
                <p>{privacy}</p>
              </InfoPopover>
            </div>
          ) : null}
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
      {scope && <div className={styles.scope}>{scope}</div>}
    </div>
  );
}
