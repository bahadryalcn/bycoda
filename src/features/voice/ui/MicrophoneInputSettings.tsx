import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import { useMicrophonePermission } from "./useMicrophonePermission";
import { isMicrophoneBlocked, microphoneBlockedMessage } from "../model/microphoneAccess";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { audioDeviceChoices, useAudioDevices } from "./useAudioDevices";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Play, Square, Trash2 } from "../../../shared/ui/icons";
import { Select, SettingsFeedback } from "../../../shared/ui/settings";
import { MicrophoneRecording, type MicrophoneRecordingState } from "../model/microphoneRecording";
import { useVoiceSettings } from "../model/voiceSettings";
import { saveVoiceSettingsPatch } from "../model/voiceSettingsSave";
import { useActiveDictations } from "../model/dictationActivity";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../model/voiceActivity";

/** Device selection and local acoustic test, independent of companion installation. */
export function MicrophoneInputSettings() {
  const settings = useVoiceSettings();
  const companion = useSyncExternalStore(
    subscribeVoiceConversationActivity,
    isVoiceConversationActive,
    () => false,
  );
  const dictations = useActiveDictations();
  const microphoneInUse = companion || dictations.length > 0;
  const { devices, unidentified } = useAudioDevices("audioinput");
  const [state, setState] = useState<MicrophoneRecordingState>("idle");
  const [testMessage, setTestMessage] = useState("");
  const recording = useRef<MicrophoneRecording | undefined>(undefined);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the recording controller and release its capture, playback and object URLs when settings close.
  useEffect(() => {
    const controller = new MicrophoneRecording((next, message) => {
      setState(next);
      setTestMessage(message ?? "");
    });
    recording.current = controller;
    return () => {
      controller.dispose();
      recording.current = undefined;
    };
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Release the previous microphone's external recording when the saved input device changes elsewhere.
  useEffect(() => {
    recording.current?.cancel();
  }, [settings.microphoneId]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Release the test capture when a conversation or dictation acquires microphone ownership.
  useEffect(() => {
    if (microphoneInUse) recording.current?.cancel();
  }, [microphoneInUse]);
  const missing =
    !!settings.microphoneId &&
    !unidentified &&
    !devices.some((device) => device.deviceId === settings.microphoneId);
  // Permission shows up only when something is wrong: a failed test, or a passive denial.
  const denied = useMicrophonePermission() === "denied";
  const problem = testMessage || (denied ? microphoneBlockedMessage() : "");
  const hasRecording = state === "ready" || state === "playing";
  // The test button keeps one slot; its label follows the state so the row never reflows.
  const testLabels = [
    t("Record test"),
    t("Recording…"),
    t("Listen"),
    t("Stop playback"),
    t("Cancel"),
  ];
  return (
    <Row
      id="voice-microphone-input"
      label={t("Microphone")}
      description={
        microphoneInUse
          ? t("Stop voice or dictation before recording a microphone test.")
          : t(
              "Record up to ten seconds and listen back. Audio stays on this device and is not transcribed.",
            )
      }
      descriptionVisible={microphoneInUse}
      feedback={
        problem ? (
          <>
            <SettingsFeedback state="error">{problem}</SettingsFeedback>
            <MicrophoneRecoveryAction blocked={isMicrophoneBlocked(problem)} />
          </>
        ) : missing ? (
          <SettingsFeedback state="warning">
            {t(
              "The selected microphone is unavailable. Select another input device or reconnect it, then try again.",
            )}
          </SettingsFeedback>
        ) : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <Select
          hideLabel
          label={t("Microphone")}
          value={settings.microphoneId ?? ""}
          options={audioDeviceChoices("audioinput", devices, unidentified, settings.microphoneId)}
          onChange={(microphoneId) => saveVoiceSettingsPatch({ microphoneId })}
        />
        {state === "requesting" ? (
          <Button
            variant="secondary"
            size="sm"
            reserveLabels={testLabels}
            onClick={() => recording.current?.cancel()}
          >
            {t("Cancel")}
          </Button>
        ) : state === "recording" ? (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Square className="icon-sm" />}
            reserveLabels={testLabels}
            tooltip={t("Stop recording")}
            onClick={() => recording.current?.stop()}
          >
            {t("Recording…")}
          </Button>
        ) : state === "playing" ? (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Square className="icon-sm" />}
            reserveLabels={testLabels}
            onClick={() => recording.current?.stopPlayback()}
          >
            {t("Stop playback")}
          </Button>
        ) : state === "ready" ? (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Play className="icon-sm" />}
            reserveLabels={testLabels}
            onClick={() => void recording.current?.play()}
          >
            {t("Listen")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            reserveLabels={testLabels}
            // ui-drift-ignore: disabled-without-reason -- the row warning beside this button names the cause
            disabled={missing || microphoneInUse}
            onClick={() => void recording.current?.record(settings.microphoneId)}
          >
            {t("Record test")}
          </Button>
        )}
        {/* Always mounted so the Select keeps its place; only a finished recording can be deleted. */}
        <Button
          iconOnly
          variant="ghost"
          label={t("Delete recording")}
          // ui-drift-ignore: disabled-without-reason -- nothing to delete until a test is recorded
          disabled={!hasRecording}
          onClick={() => recording.current?.cancel()}
        >
          <Trash2 className="icon-sm" />
        </Button>
      </div>
    </Row>
  );
}
