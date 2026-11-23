import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import { useMicrophonePermission } from "./useMicrophonePermission";
import { microphoneBlockedMessage } from "../model/microphoneAccess";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";
import { X } from "../../../shared/ui/icons";
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
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // Browsers list microphones without ids until capture permission is granted; the test is the
  // only path that asks for it, so an unknown list must not look like an unplugged device.
  const [unidentified, setUnidentified] = useState(false);
  const [state, setState] = useState<MicrophoneRecordingState>("idle");
  const [error, setError] = useState("");
  const recording = useRef<MicrophoneRecording | undefined>(undefined);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the devicechange listener attached only while microphone settings are mounted, without requesting capture.
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void navigator.mediaDevices
        ?.enumerateDevices?.()
        .then((all) => {
          if (!live) return;
          const inputs = all.filter((device) => device.kind === "audioinput");
          setDevices(inputs.filter((device) => device.deviceId));
          setUnidentified(inputs.some((device) => !device.deviceId));
        })
        .catch(() => {
          if (live) setDevices([]);
        });
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the recording controller and release its capture, playback and object URLs when settings close.
  useEffect(() => {
    const controller = new MicrophoneRecording((next, message) => {
      setState(next);
      setError(message ?? "");
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
  const busy = state === "requesting" || state === "recording" || state === "playing";
  const missing =
    settings.microphoneId &&
    !unidentified &&
    !devices.some((device) => device.deviceId === settings.microphoneId);
  // Permission shows up only when something is wrong: a failed test, or a passive denial.
  const denied = useMicrophonePermission() === "denied";
  const problem = error ? t(error) : denied ? microphoneBlockedMessage() : "";
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
            <MicrophoneRecoveryAction message={error || problem} />
          </>
        ) : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <Select
          hideLabel
          label={t("Microphone")}
          value={settings.microphoneId ?? ""}
          options={[
            { value: "", label: t("System default") },
            ...devices.map((device, index) => ({
              value: device.deviceId,
              label: device.label || t("Microphone {p1}", { p1: String(index + 1) }),
            })),
            ...(missing
              ? [
                  {
                    value: settings.microphoneId!,
                    label: t("Selected microphone unavailable"),
                    disabled: true,
                  },
                ]
              : []),
          ]}
          onChange={(microphoneId) => saveVoiceSettingsPatch({ microphoneId })}
        />
        <ButtonGroup aria-label={t("Microphone test")}>
          {/* One primary that follows the recording: Record, then Stop, then Play. */}
          {state === "recording" ? (
            <Button onClick={() => recording.current?.stop()}>{t("Stop recording")}</Button>
          ) : state === "ready" ? (
            <Button onClick={() => void recording.current?.play()}>{t("Play recording")}</Button>
          ) : (
            <Button
              disabled={busy || !!missing || microphoneInUse}
              loading={state === "requesting"}
              onClick={() => void recording.current?.record(settings.microphoneId)}
            >
              {t("Record test")}
            </Button>
          )}
          {state === "requesting" ? (
            <Button onClick={() => recording.current?.cancel()}>{t("Cancel")}</Button>
          ) : state !== "idle" ? (
            <Button
              iconOnly
              label={t("Discard recording")}
              onClick={() => recording.current?.cancel()}
            >
              <X className="icon-sm" />
            </Button>
          ) : null}
        </ButtonGroup>
      </div>
    </Row>
  );
}
