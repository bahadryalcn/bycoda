import { useEffect, useRef, useState } from "react";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Button } from "../../../../shared/ui/Button";
import { Meter } from "../../../../shared/ui/Meter";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { OverflowTooltip, Tooltip } from "../../../../shared/ui/Tooltip";
import { Globe, MessageMultiple, Square } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { formatDuration } from "../../../../shared/i18n/format";
import { elapsedSince, monotonicNow } from "../../../../shared/lib/time/timestamps";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import { VoiceCore } from "./VoiceCore";
import { voiceStatusTone } from "./VoiceLauncher";
import styles from "./VoiceCompanionParts.module.css";

const METER_SEGMENTS = 10;

/**
 * The stage of the expanded panel. Row one: the voice core (avatar inside state rings) beside
 * what voice is doing, what it applies to and live readouts. Row two holds the scope choice, so
 * no state moves another control.
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
  onScopeChange,
  onStopWork,
}: {
  visualState: VoiceVisualState;
  working: boolean;
  audioLevel: { readonly current: number };
  statusText: string;
  sessionStatusText: string;
  /** Connected and capturing; shows the input meter and session clock. */
  live: boolean;
  /** Who runs the voice: the realtime provider or this computer. */
  engine: string;
  /** Where audio goes; shown with the engine readout. */
  privacy: string;
  workspace: boolean;
  globalScope: boolean;
  /** Assistant name; empty before setup, when there is no avatar to show. */
  name: string;
  avatar: string | undefined;
  onScopeChange: (global: boolean) => void;
  onStopWork: () => void;
}) {
  const tone = voiceStatusTone(visualState);
  const caption = working ? sessionStatusText : "";
  return (
    <div className={styles.stage}>
      <div className={styles.status}>
        <VoiceCore state={visualState} level={audioLevel} name={name} avatar={avatar} />
        <div className={styles.statusText}>
          <div className={styles.statusLine}>
            {tone && <StatusDot tone={tone} size="fixed" appearance="solid" />}
            <LiveText size="secondary" weight="medium" leading="snug" truncate text={statusText} />
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
          {caption ? (
            <OverflowTooltip label={caption}>
              <Text as="span" size="caption" tone="secondary" leading="snug" truncate>
                {caption}
              </Text>
            </OverflowTooltip>
          ) : null}
          <VoiceReadouts live={live} engine={engine} privacy={privacy} level={audioLevel} />
        </div>
      </div>
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
 * Live facts under the status line: the engine (with where audio goes), and while connected the
 * measured input level and how long this voice session has run. Both live readouts are painted
 * from timers, so the meter does not re-render the panel.
 */
function VoiceReadouts({
  live,
  engine,
  privacy,
  level,
}: {
  live: boolean;
  engine: string;
  privacy: string;
  level: { readonly current: number };
}) {
  const meter = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [inputLevel, setInputLevel] = useState(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- session clock and input meter timers run only while voice is live
  useEffect(() => {
    if (!live) return;
    const start = monotonicNow();
    const paint = () => {
      const measured = level.current;
      const input = Number.isFinite(measured) ? Math.max(0, Math.min(1, measured)) : 0;
      const lit = Math.round(input * METER_SEGMENTS);
      setInputLevel(lit * 10);
      meter.current?.querySelectorAll("i").forEach((segment, index) => {
        segment.toggleAttribute("data-on", index < lit);
      });
    };
    const tick = () => {
      if (clock.current)
        clock.current.textContent = formatDuration(elapsedSince(start), { style: "clock" });
    };
    tick();
    paint();
    const meterTimer = setInterval(paint, 120);
    const clockTimer = setInterval(tick, 1000);
    return () => {
      clearInterval(meterTimer);
      clearInterval(clockTimer);
    };
  }, [live, level]);
  return (
    <div className={styles.readouts}>
      <div {...surfaceAttributes({ frame: "stroke", edge: "block-start" }, styles.readout)}>
        <Text size="caption" tone="muted" leading="none">
          {t("Voice engine")}
        </Text>
        <Tooltip asChild label={privacy}>
          <Text size="caption" tone="primary" weight="medium" leading="none" truncate tabIndex={0}>
            {engine}
          </Text>
        </Tooltip>
      </div>
      {live ? (
        <>
          <div {...surfaceAttributes({ frame: "stroke", edge: "block-start" }, styles.readout)}>
            <Text size="caption" tone="muted" leading="none">
              {t("Input")}
            </Text>
            <>
              <Meter className="sr-only" label={t("Input")} value={inputLevel} />
              <span ref={meter} className={styles.meter} aria-hidden="true">
                {Array.from({ length: METER_SEGMENTS }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
            </>
          </div>
          <div {...surfaceAttributes({ frame: "stroke", edge: "block-start" }, styles.readout)}>
            <Text size="caption" tone="muted" leading="none">
              {t("Session")}
            </Text>
            <Text ref={clock} size="caption" tone="primary" weight="medium" leading="none" />
          </div>
        </>
      ) : null}
    </div>
  );
}
