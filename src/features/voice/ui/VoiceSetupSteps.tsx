import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../settings/ui/settingsControls";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
} from "../model/voiceSettings";
import { realtimeSecret } from "../model/realtimeVoiceClient";
import { localVoiceBackend } from "../model/localVoiceClient";
import { speakerEngine, speakerOptions } from "../model/voiceSpeakers";
import { previewVoice } from "../model/voicePreview";
import { RealtimeVoice } from "../model/realtimeVoice";
import { LocalVoice } from "../model/localVoice";
import { voiceLanguageCode } from "../model/voiceLanguage";
import { VoiceSettings } from "./VoiceSettings";
import { InlineError } from "../../../shared/ui/InlineError";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import styles from "./VoiceSetupSteps.module.css";

export function VoiceSetupSteps({
  step,
  onValidChange,
  language = "auto",
  name = "",
  onEvidence,
}: {
  step: "provider" | "voice" | "microphone";
  onValidChange: (valid: boolean) => void;
  language?: string;
  name?: string;
  onEvidence?: (e: {
    providerVerified?: boolean;
    voiceVerified?: boolean;
    microphoneVerified?: boolean;
  }) => void;
}) {
  const settings = useVoiceSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const level = useRef(0);
  const [volume, setVolume] = useState(0);
  const playback = useRef<AbortController | null>(null);
  const mic = useRef<RealtimeVoice | LocalVoice | null>(null);
  const epoch = useRef(0);
  const callbacks = useRef({ onValidChange, onEvidence });
  callbacks.current = { onValidChange, onEvidence };
  const config = JSON.stringify({ step, settings, language });
  useEffect(() => {
    if (step !== "microphone") return;
    const timer = setInterval(() => setVolume(level.current), 120);
    return () => clearInterval(timer);
  }, [step]);
  useEffect(() => {
    epoch.current++;
    callbacks.current.onValidChange(false);
    setConfirmed(false);
    setError("");
    setBusy(false);
    setTranscript("");
    return () => {
      epoch.current++;
      playback.current?.abort();
      mic.current?.close();
      mic.current = null;
    };
  }, [config]);
  const valid = (e: Parameters<NonNullable<typeof onEvidence>>[0]) => {
    setConfirmed(true);
    callbacks.current.onValidChange(true);
    callbacks.current.onEvidence?.(e);
  };
  async function check() {
    if (busy) return;
    const attempt = epoch.current;
    setConfirmed(false);
    callbacks.current.onValidChange(false);
    setBusy(true);
    setError("");
    try {
      if (settings.mode === "local") {
        const status = await localVoiceBackend.inspect(voiceRuntimeSettings(settings));
        if (!status.ready)
          throw new Error(status.missing.join(", ") || "Local voice is not ready.");
      } else await realtimeSecret(settings.mode === "grok" ? "xai" : "openai");
      if (epoch.current === attempt) valid({ providerVerified: true });
    } catch (cause) {
      if (epoch.current === attempt) setError(errorText(cause));
    } finally {
      if (epoch.current === attempt) setBusy(false);
    }
  }
  async function listen() {
    playback.current?.abort();
    const controller = new AbortController();
    playback.current = controller;
    const attempt = epoch.current;
    setConfirmed(false);
    callbacks.current.onValidChange(false);
    setBusy(true);
    setError("");
    try {
      await previewVoice(settings, language, name, controller.signal, () => {
        if (epoch.current === attempt) {
          valid({ voiceVerified: true });
          setBusy(false);
        }
      });
    } catch (cause) {
      if (epoch.current === attempt && !controller.signal.aborted) {
        setError(errorText(cause));
        setBusy(false);
      }
    }
  }
  async function testMicrophone() {
    if (busy) return;
    const attempt = epoch.current;
    setConfirmed(false);
    callbacks.current.onValidChange(false);
    setBusy(true);
    setError("");
    setTranscript("");
    const accepted = (text: string, detected?: string) => {
      if (epoch.current !== attempt) return;
      setTranscript(text);
      const expected = voiceLanguageCode(language);
      if (expected && detected && voiceLanguageCode(detected) !== expected) {
        setError(t("The recognized language differs from your chosen language."));
      } else valid({ microphoneVerified: true });
      mic.current?.close();
      mic.current = null;
      setBusy(false);
    };
    const failed = (message: string) => {
      if (epoch.current === attempt) {
        setError(message);
        setBusy(false);
        mic.current?.close();
        mic.current = null;
      }
    };
    try {
      if (settings.mode === "local") {
        const voice = new LocalVoice(
          {
            start: () => ({ sequence: 0 }),
            transcript: (result) => accepted(result.text, result.language),
            state: () => {},
            error: failed,
          },
          voiceLanguageCode(language) ?? "",
          voiceRuntimeSettings(settings),
          level,
          { languageLock: voiceLanguageCode(language), deviceId: settings.microphoneId },
        );
        mic.current = voice;
        await voice.connect();
      } else {
        const voice = new RealtimeVoice(
          settings.mode === "grok" ? "xai" : "openai",
          {
            state: () => {},
            reply: () => {},
            transcript: accepted,
            playback: () => {},
            tool: async () => ({ error: "Tools are disabled during microphone test." }),
            error: failed,
          },
          "en",
          level,
          settings.speakers[settings.mode],
          "",
          language,
        );
        mic.current = voice;
        const secret = await realtimeSecret(settings.mode === "grok" ? "xai" : "openai");
        if (epoch.current === attempt)
          await voice.connect(secret, [], { deviceId: settings.microphoneId });
      }
      if (epoch.current === attempt && navigator.mediaDevices?.enumerateDevices)
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (device) => device.kind === "audioinput",
          ),
        );
    } catch (cause) {
      failed(errorText(cause));
    }
  }
  const engine = speakerEngine(settings);
  return (
    <div className={styles.step}>
      {step === "provider" ? (
        <>
          <SegmentedControl
            value={settings.mode}
            onValueChange={(mode) =>
              saveVoiceSettings({ ...loadVoiceSettings(), mode: mode as typeof settings.mode })
            }
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "grok", label: "Grok (xAI)" },
              { value: "local", label: t("On this computer") },
            ]}
            label={t("Voice provider")}
          />
          <div className={styles.actions}>
            <Button onClick={() => void check()} loading={busy}>
              {t("Check connection")}
            </Button>
            {confirmed ? (
              <span role="status" className={styles.confirmed}>
                {t("Ready")}
              </span>
            ) : null}
          </div>
          <details
            className={styles.details}
            onToggle={(event) => setAdvanced(event.currentTarget.open)}
          >
            <summary>{t("Voice settings")}</summary>
            {advanced ? (
              <div>
                <VoiceSettings />
              </div>
            ) : null}
          </details>
        </>
      ) : null}
      {step === "voice" ? (
        <>
          {engine ? (
            <Select
              label={t("Voice")}
              value={settings.speakers[engine]}
              options={speakerOptions(engine)}
              onChange={(value) =>
                saveVoiceSettings({
                  ...loadVoiceSettings(),
                  speakers: { ...settings.speakers, [engine]: value },
                })
              }
            />
          ) : null}
          <div className={styles.actions}>
            <Button onClick={() => void listen()} loading={busy}>
              {t("Listen")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                playback.current?.abort();
                setBusy(false);
              }}
            >
              {t("Stop")}
            </Button>
            {confirmed ? (
              <span role="status" className={styles.confirmed}>
                {t("Ready")}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
      {step === "microphone" ? (
        <>
          <Select
            label={t("Microphone")}
            value={settings.microphoneId ?? ""}
            options={[
              { value: "", label: t("System default") },
              ...devices.map((device) => ({
                value: device.deviceId,
                label: device.label || device.deviceId,
              })),
            ]}
            onChange={(microphoneId) => saveVoiceSettings({ ...loadVoiceSettings(), microphoneId })}
          />
          <p className={styles.hint}>{t("Start the microphone test, then say one sentence.")}</p>
          <div className={styles.actions}>
            <Button onClick={() => void testMicrophone()} loading={busy}>
              {t("Test microphone")}
            </Button>
            {busy ? (
              <Button
                onClick={() => {
                  epoch.current++;
                  mic.current?.close();
                  mic.current = null;
                  setBusy(false);
                }}
              >
                {t("Stop")}
              </Button>
            ) : null}
            <meter
              className={styles.level}
              min={0}
              max={1}
              value={volume}
              aria-label={t("Microphone level")}
            />
          </div>
          {transcript ? (
            <p className={styles.transcript} role="status">
              {transcript}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? <InlineError action={<MicrophoneRecoveryAction message={error} />}>{error}</InlineError> : null}
    </div>
  );
}
