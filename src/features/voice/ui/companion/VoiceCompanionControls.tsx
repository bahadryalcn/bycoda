import { Button } from "../../../../shared/ui/Button";
import {
  MessageSquare,
  Mic,
  MicOff,
  Hand,
  PhoneOff,
  Volume2,
  VolumeX,
  X,
} from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { VoiceTurnControl } from "../VoiceTurnControl";
import type { VoiceCompanionStatus } from "./voiceCompanionTypes";
import styles from "./VoiceCompanionParts.module.css";

/**
 * The expanded footer: a centred, phone-style dock of round buttons. While live, the turn-ending
 * choice sits above conversation, mic, silence, speaker and the red disconnect. Every icon has a
 * tooltip and the same accessible name.
 */
export function VoiceCompanionControls({
  status,
  startDisabled,
  muted,
  speakerMuted,
  manual,
  chatShown,
  onToggleChat,
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
  /** Floating panel transcript replaces its stage. Fullscreen has a header toggle. */
  chatShown: boolean;
  onToggleChat?: () => void;
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
  const chat = onToggleChat && (
    <Button
      iconOnly
      shape="pill"
      size="lg"
      label={t("Conversation")}
      pressed={chatShown}
      onClick={onToggleChat}
    >
      <MessageSquare className="icon-sm" />
    </Button>
  );
  if (connecting)
    return (
      <div className={styles.callDock}>
        <Button
          shape="pill"
          size="lg"
          label={t(status === "reconnecting" ? "Stop" : "Cancel")}
          startIcon={<X className="icon-sm" />}
          onClick={onClose}
        >
          {t(status === "reconnecting" ? "Stop" : "Cancel")}
        </Button>
      </div>
    );
  if (canTalk)
    return (
      <div className={styles.callDock}>
        {chat}
        <Button
          variant="primary"
          shape="pill"
          size="lg"
          data-voice-start
          disabled={startDisabled}
          onClick={onStart}
          startIcon={<Mic className="icon-sm" />}
        >
          {t(status === "idle" ? "Start voice" : "Talk")}
        </Button>
        {status !== "idle" && (
          <Button
            shape="pill"
            size="lg"
            tone="danger"
            aria-label={t("Disconnect voice")}
            startIcon={<PhoneOff className="icon-sm" />}
            onClick={onClose}
          >
            {t("Disconnect")}
          </Button>
        )}
      </div>
    );
  return (
    <div className={styles.callFooter}>
      {status === "live" && (
        <div className={styles.callDock}>
          <VoiceTurnControl
            manual={manual}
            muted={muted}
            onManualChange={onManualChange}
            onFinish={onFinish}
          />
        </div>
      )}
      <div className={styles.callDock}>
        {chat}
        <Button
          iconOnly
          shape="pill"
          size="lg"
          label={t("Mute microphone")}
          variant={muted ? "secondary" : "primary"}
          tone={muted ? "danger" : undefined}
          disabled={status !== "live"}
          pressed={muted}
          onClick={onToggleMute}
        >
          {muted ? <MicOff className="icon-sm" /> : <Mic className="icon-sm" />}
        </Button>
        <Button iconOnly shape="pill" size="lg" label={t("Stop speaking")} onClick={onSilence}>
          <Hand className="icon-sm" />
        </Button>
        <Button
          iconOnly
          shape="pill"
          size="lg"
          label={t("Mute speaker")}
          pressed={speakerMuted}
          onClick={onToggleSpeaker}
        >
          {speakerMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
        </Button>
        <Button
          shape="pill"
          size="lg"
          tone="danger"
          aria-label={t("Disconnect voice")}
          startIcon={<PhoneOff className="icon-sm" />}
          onClick={onClose}
        >
          {t("Disconnect")}
        </Button>
      </div>
    </div>
  );
}
