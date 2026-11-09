import { Button } from "../../../../shared/ui/Button";
import { Mic, MicOff, Pause, Square, Volume2, VolumeX, X } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { VoiceTurnControl } from "../VoiceTurnControl";
import type { VoiceCompanionStatus } from "./voiceCompanionTypes";
import styles from "./VoiceCompanionParts.module.css";

/**
 * The expanded footer. Turn mode and Finish sit on the left; mic, silence, speaker and the red
 * disconnect sit on the right. Every icon has a tooltip and the same accessible name.
 */
export function VoiceCompanionControls({
  status,
  startDisabled,
  muted,
  speakerMuted,
  manual,
  onStart,
  onClose,
  onToggleMute,
  onToggleSpeaker,
  onSilence,
  onFinish,
  onManualChange,
}: {
  status: VoiceCompanionStatus;
  startDisabled: boolean;
  muted: boolean;
  speakerMuted: boolean;
  manual: boolean;
  onStart: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onSilence: () => void;
  onFinish: () => void;
  onManualChange: (manual: boolean) => void;
}) {
  const canTalk = status === "idle" || status === "sleeping" || status === "ready";
  const connecting = status === "connecting" || status === "reconnecting";
  const speakerLabel = t(speakerMuted ? "Unmute speaker" : "Mute speaker");
  if (connecting)
    return (
      <div className={styles.bar}>
        <span className={styles.spacer} />
        <Button label={t("Cancel")} startIcon={<X className="icon-sm" />} onClick={onClose}>
          {t("Cancel")}
        </Button>
      </div>
    );
  if (canTalk)
    return (
      <div className={styles.bar}>
        <span className={styles.spacer} />
        <Button
          variant="primary"
          data-voice-start
          disabled={startDisabled}
          onClick={onStart}
          startIcon={<Mic className="icon-sm" />}
        >
          {t(status === "idle" ? "Start voice" : "Talk")}
        </Button>
        {status !== "idle" && (
          <Button
            iconOnly
            variant="danger"
            label={t("Disconnect voice")}
            tooltip={t("Disconnect voice")}
            onClick={onClose}
          >
            <Square className="icon-sm" />
          </Button>
        )}
      </div>
    );
  return (
    <div className={styles.bar}>
      {status === "live" && (
        <VoiceTurnControl
          manual={manual}
          muted={muted}
          onManualChange={onManualChange}
          onFinish={onFinish}
        />
      )}
      <span className={styles.spacer} />
      <Button
        iconOnly
        label={t(muted ? "Resume" : "Pause mic")}
        tooltip={t(muted ? "Resume" : "Pause mic")}
        variant={muted ? "secondary" : "primary"}
        tone={muted ? "danger" : undefined}
        disabled={status !== "live"}
        selected={muted}
        aria-pressed={muted}
        onClick={onToggleMute}
      >
        {muted ? <MicOff className="icon-sm" /> : <Mic className="icon-sm" />}
      </Button>
      <Button iconOnly label={t("Silence")} tooltip={t("Silence")} onClick={onSilence}>
        <Pause className="icon-sm" />
      </Button>
      <Button
        iconOnly
        label={speakerLabel}
        tooltip={speakerLabel}
        selected={speakerMuted}
        aria-pressed={speakerMuted}
        onClick={onToggleSpeaker}
      >
        {speakerMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
      </Button>
      <Button
        iconOnly
        variant="danger"
        label={t("Disconnect voice")}
        tooltip={t("Disconnect voice")}
        onClick={onClose}
      >
        <Square className="icon-sm" />
      </Button>
    </div>
  );
}
