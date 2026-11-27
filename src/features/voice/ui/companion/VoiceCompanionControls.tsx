import type { Ref } from "react";
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
import { useVoiceDeviceContextMenu } from "./voiceDeviceMenus";
import styles from "./VoiceCompanionParts.module.css";

/**
 * The expanded footer: a centred, phone-style dock of round buttons. While live, the turn-ending
 * choice sits above conversation, mic, silence, speaker and the red disconnect. Every icon has the
 * same accessible name as its tooltip. Right-click on the mic or speaker picks its device.
 */
export function VoiceCompanionControls({
  status,
  startDisabled,
  muted,
  speakerMuted,
  manual,
  chatShown,
  chatToggleRef,
  chatPanelId,
  onToggleChat,
  chatHidden,
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
  /** The one transcript toggle, on every size: floating replaces the stage, fullscreen opens a drawer. */
  chatShown: boolean;
  chatToggleRef?: Ref<HTMLButtonElement>;
  chatPanelId?: string;
  onToggleChat?: () => void;
  /** Keeps the toggle's slot while a question fills the stage, so the dock does not shift. */
  chatHidden?: boolean;
  onStart: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onSilence: () => void;
  onFinish: () => void;
  onManualChange: (manual: boolean) => void;
}) {
  const microphoneMenu = useVoiceDeviceContextMenu("audioinput");
  const outputMenu = useVoiceDeviceContextMenu("audiooutput");
  const canTalk = status === "idle" || status === "sleeping" || status === "ready";
  const connecting = status === "connecting" || status === "reconnecting";
  const chat = onToggleChat && (
    <Button
      ref={chatToggleRef}
      iconOnly
      shape="pill"
      size="lg"
      label={t("Conversation")}
      aria-controls={chatPanelId}
      className={chatHidden ? "invisible" : undefined}
      pressed={chatShown}
      onClick={onToggleChat}
    >
      <MessageSquare className="icon-sm" />
    </Button>
  );
  const connectingLabel = status === "reconnecting" ? t("Stop") : t("Cancel");
  if (connecting)
    return (
      <div className={styles.callDock}>
        <Button
          shape="pill"
          size="lg"
          label={connectingLabel}
          startIcon={<X className="icon-sm" />}
          onClick={onClose}
        >
          {connectingLabel}
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
          disabledReason={
            startDisabled ? t("Select a workspace or session to start voice.") : undefined
          }
          onClick={onStart}
          startIcon={<Mic className="icon-sm" />}
        >
          {status === "idle" ? t("Start voice") : t("Talk")}
        </Button>
        {status !== "idle" && (
          <Button
            iconOnly
            shape="pill"
            size="lg"
            tone="danger"
            label={t("Disconnect voice")}
            onClick={onClose}
          >
            <PhoneOff className="icon-sm" />
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
          disabledReason={t("Voice is not connected yet.")}
          pressed={muted}
          onClick={onToggleMute}
          {...microphoneMenu.trigger}
        >
          {muted ? <MicOff className="icon-sm" /> : <Mic className="icon-sm" />}
        </Button>
        {microphoneMenu.menu}
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
          {...outputMenu.trigger}
        >
          {speakerMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
        </Button>
        {outputMenu.menu}
        <Button
          iconOnly
          shape="pill"
          size="lg"
          tone="danger"
          label={t("Disconnect voice")}
          onClick={onClose}
        >
          <PhoneOff className="icon-sm" />
        </Button>
      </div>
    </div>
  );
}
