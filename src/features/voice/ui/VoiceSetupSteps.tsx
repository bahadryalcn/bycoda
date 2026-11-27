import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/settings";
import { t } from "../../../shared/i18n";
import { voiceProviderLabel, voiceProviderOptions } from "../model/voiceProviders";
import { errorText } from "../../../shared/lib/errors";
import { withTimeout } from "../../../shared/lib/withTimeout";
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
import { MicrophoneInputSettings } from "./MicrophoneInputSettings";
import { openSettingsSection } from "../../settings/public/settingsLink";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { isMicrophoneBlocked } from "../model/microphoneAccess";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import styles from "./VoiceSetupSteps.module.css";

export function VoiceSetupSteps({
  step,
  onValidChange,
  language = "auto",
  name = "",
}: {
  step: "provider" | "voice" | "microphone";
  onValidChange: (valid: boolean) => void;
  language?: string;
  name?: string;
}) {
  const settings = useVoiceSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const playback = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const callback = useRef(onValidChange);
  callback.current = onValidChange;
  const config = JSON.stringify({ step, settings, language });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Release playback and discard stale check results when configuration changes.
  useEffect(() => {
    epoch.current++;
    callback.current(false);
    setConfirmed(false);
    setError("");
    setBusy(false);
    return () => {
      epoch.current++;
      playback.current?.abort();
    };
  }, [config]);
  const valid = () => {
    setConfirmed(true);
    callback.current(true);
  };
  async function check() {
    if (busy) return;
    const attempt = epoch.current;
    setConfirmed(false);
    callback.current(false);
    setBusy(true);
    setError("");
    try {
      if (settings.mode === "local") {
        const status = await withTimeout(
          localVoiceBackend.inspect(voiceRuntimeSettings(settings)),
          20_000,
          t("Check connection"),
        );
        if (!status.ready)
          throw new Error(status.missing.join(", ") || "Local voice is not ready.");
      } else {
        await withTimeout(
          realtimeSecret(settings.mode === "grok" ? "xai" : "openai"),
          15_000,
          t("Check connection"),
        );
      }
      if (epoch.current === attempt) valid();
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
    callback.current(false);
    setBusy(true);
    setError("");
    try {
      await previewVoice(settings, language, name, controller.signal, () => {
        if (epoch.current === attempt) {
          valid();
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
            options={voiceProviderOptions()}
            label={t("Voice provider")}
          />
          <div className={styles.actions}>
            <Button onClick={() => void check()} loading={busy}>
              {t("Check {p0}", { p0: voiceProviderLabel(settings.mode) })}
            </Button>
            <LiveText
              size="caption"
              tone="success"
              className={confirmed ? undefined : "sr-only"}
              text={confirmed ? t("Ready") : ""}
            />
          </div>
          {error && (
            <Button variant="ghost" onClick={() => openSettingsSection("voice")}>
              {t("Voice settings")}
            </Button>
          )}
        </>
      ) : null}
      {step === "voice" ? (
        <>
          {engine ? (
            <Select
              label={t("Speaker")}
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
              disabled={!busy && !confirmed}
              disabledReason={t("Nothing is playing.")}
              onClick={() => {
                epoch.current++;
                playback.current?.abort();
                setBusy(false);
              }}
            >
              {t("Stop")}
            </Button>
            <LiveText
              size="caption"
              tone="success"
              className={confirmed ? undefined : "sr-only"}
              text={confirmed ? t("Ready") : ""}
            />
          </div>
        </>
      ) : null}
      {step === "microphone" ? <MicrophoneInputSettings /> : null}
      {error ? (
        <InlineError
          details={error}
          extra={<MicrophoneRecoveryAction blocked={isMicrophoneBlocked(error)} />}
        >
          {step === "provider"
            ? t("Could not check the voice provider.")
            : t("Could not play the voice preview.")}
        </InlineError>
      ) : null}
    </div>
  );
}
